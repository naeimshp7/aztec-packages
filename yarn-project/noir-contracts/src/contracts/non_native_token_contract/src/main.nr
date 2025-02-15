mod hash;
mod storage;
mod transparent_note;

// Represents an ERC20 token bridged from L1 to L2 via `l1-contracts/test/portals/TokenPortal.sol`. The bridged user
// balance can be stored in both public and private domain. If the balance is stored in the private domain then it
// is represented as a set of notes in the private data tree. If the balance is stored in the public domain then it is
// represented as a single value in the public data tree.
//
// It is also used to test insertion of a note from public domain into the private data tree. How this works is that
// a user provides a secret hash as an argument on the input of the public function, and the contract then inserts
// a note into the private data tree once the public call is processed. A note can later on be spent by providing
// the secret hash preimage on the input of a private function call.
//
// This flow will be typically used when performing a token swap:
// 1. A calls a private function which enqueues a public call to the DEX contract (with the secret hash on input).
// 2. The sequencer performs the public call to the DEX and the note gets inserted into the private data tree.
// 3. At this point a recipient can spend the note in a private function assuming he/she knows the secret.
contract NonNativeToken {
    // Libs
    use dep::value_note::{
        balance_utils,
        utils::{send_note, spend_notes},
        value_note::{VALUE_NOTE_LEN, ValueNoteMethods},
    };

    use crate::transparent_note::{
        TransparentNote,
        TransparentNoteMethods,
        TRANSPARENT_NOTE_LEN,
    };

    use crate::storage::Storage;
    use crate::hash::{get_mint_content_hash, get_withdraw_content_hash};

    use dep::aztec::context::Context;
    use dep::aztec::types::point::Point;
    use dep::aztec::{
        abi,
        abi::{
            PublicContextInputs,
            PrivateContextInputs,
        },
        note::{
            note_header::NoteHeader,
            utils as note_utils,
        },
    };

    // oracles
    use dep::aztec::oracle::{
        create_l2_to_l1_message::create_l2_to_l1_message,
    };

    // public messaging
    use dep::aztec::messaging::consume_l1_to_l2_message_public;
    use dep::aztec::public_call_stack_item::PublicCallStackItem;

    use dep::aztec::oracle::create_commitment::create_commitment;

    fn constructor(
        //*********************************/
        // Should eventually be hidden:
        inputs: PrivateContextInputs,
        //*********************************/
        initial_supply: Field,
        owner: Field,
    ) -> distinct pub abi::PrivateCircuitPublicInputs {
        let storage = Storage::init();

        let mut context = Context::new(inputs, abi::hash_args([initial_supply, owner]));

        let balance = storage.balances.at(owner);
        send_note(&mut context, balance, initial_supply, owner);

        // Return private circuit public inputs. All private functions need to return this as it is part of the input of the private kernel.
        context.finish()
    }

    // Mint Private Function
    // This mint function differs to the typical token mint function as it only allows minting
    // upon consuming valid messages from a token portal contract
    fn mint(
        //*********************************/
        // Should eventually be hidden:
        inputs: PrivateContextInputs,
        //*********************************/
        amount: Field,
        owner: Field,
        // This field should be hidden
        msg_key: Field,
        secret: Field,
        canceller: Field,
    ) -> distinct pub abi::PrivateCircuitPublicInputs {
        let storage = Storage::init();

        let mut context = Context::new(inputs, abi::hash_args([
            amount, owner, msg_key, secret, canceller
        ]));

        let content_hash = get_mint_content_hash(amount, owner, canceller);

        // Get the l1 message from an oracle call
        context.consume_l1_to_l2_message(inputs, msg_key, content_hash, secret);

        let balance = storage.balances.at(owner);
        send_note(&mut context, balance, amount, owner);

        // Return private circuit public inputs. All private functions need to return this as it is part of the input of the private kernel.
        context.finish()
    }

    // Withdraws using user's private balance.
    // @dev Destroys 2 of user's notes and sends a message to the L1 portal contract. That message can then be consumed
    //      by calling the `withdraw` function on the L1 portal contract (assuming the args are set correctly).
    fn withdraw(
        //*********************************/
        // Should eventually be hidden:
        inputs: PrivateContextInputs,
        //*********************************/
        amount: Field,
        sender: Field,
        recipient: Field, // ethereum address in the field
        callerOnL1: Field, // ethereum address that can call this function on the L1 portal (0x0 if anyone can call)
    ) -> distinct pub abi::PrivateCircuitPublicInputs {
        let storage = Storage::init();
        let mut context = Context::new(inputs, abi::hash_args([
            amount, sender, recipient, callerOnL1
        ]));

        let sender_balance = storage.balances.at(sender);
        spend_notes(&mut context, sender_balance, amount, sender);

        let content = get_withdraw_content_hash(amount, recipient, callerOnL1);
        context.message_portal(content);

        // Return private circuit public inputs. All private functions need to return this as it is part of the input of the private kernel.
        context.finish()
    }

    // Mint Public Function
    // This mint function differs to the typical token mint function as it only allows minting
    // upon consuming valid messages from a token portal contract
    open fn mintPublic(
        //*********************************/
        // Should eventually be hidden:
        inputs: PublicContextInputs,
        //*********************************/
        amount: Field,
        owner_address: Field,
        // This field should be hidden
        msg_key: Field,
        secret: Field,
        canceller: Field,
    ) -> pub Field {
        let storage = Storage::init();
        let public_balances = storage.public_balances;

        let content_hash = get_mint_content_hash(amount, owner_address, canceller);

        // Consume message and emit nullifier
        consume_l1_to_l2_message_public(inputs, msg_key, content_hash, secret);

        // Update the public balance
        let recipient_balance = public_balances.at(owner_address);
        let new_balance = recipient_balance.read() + amount;
        recipient_balance.write(new_balance);
        new_balance
    }


    // Withdraws using user's public balance.
    open fn withdrawPublic(
        //*********************************/
        // Should eventually be hidden:
        inputs: PublicContextInputs,
        //*********************************/
        amount: Field,
        recipient: Field,
        callerOnL1: Field, // ethereum address that can call this function on the L1 portal (0x0 if anyone can call)
    ) {
        let storage = Storage::init();
        let public_balances = storage.public_balances;

        let sender = inputs.call_context.msg_sender;
        let sender_balance = public_balances.at(sender);

        let current_sender_balance: Field = sender_balance.read();

        if (current_sender_balance as u120) > (amount as u120) {
            // User has sufficient balance so we decrement it by `amount`
            let _void1 = sender_balance.write(current_sender_balance - amount);
        }
        // TODO: Revert if there is not enough balance

        let content = get_withdraw_content_hash(amount, recipient, callerOnL1);

        // Emit the l2 to l1 message
        create_l2_to_l1_message(content);
    }


    // Transfers `amount` of tokens from `sender`'s private balance to a `recipient`.
    // Note: Copied from PrivateToken
    fn transfer(
        //*********************************/
        // Should eventually be hidden:
        inputs: PrivateContextInputs,
        //*********************************/
        amount: Field,
        sender: Field,
        recipient: Field,
    ) -> distinct pub abi::PrivateCircuitPublicInputs {
        let storage = Storage::init();
        let mut context = Context::new(inputs, abi::hash_args([
            amount, sender, recipient
        ]));

        // Gets the set of sender's notes and picks 2 of those.
        let sender_balance = storage.balances.at(sender);
        spend_notes(&mut context, sender_balance, amount, sender);

        let balance = storage.balances.at(recipient);
        send_note(&mut context, balance, amount, recipient);

        // Return private circuit public inputs. All private functions need to return this as it is part of the input of the private kernel.
        context.finish()
    }

    // Shield creates a way for a user to move tokens from the public context into the private context.
    open fn shield(
        inputs: PublicContextInputs,
        amount: Field,
        secretHash: Field,
    ) {
        let storage = Storage::init();
        let public_balances = storage.public_balances;
        let pending_shields = storage.pending_shields;

        // Decrease user's balance.
        let sender = inputs.call_context.msg_sender;
        let sender_balance = public_balances.at(sender);
        let current_sender_balance: Field = sender_balance.read();

        assert(current_sender_balance as u120 >= amount as u120);

        // User has sufficient balance so we decrement it by `amount`
        let _void1 = sender_balance.write(current_sender_balance - amount);

        // Create a commitment to the "amount" using the "secretHash"
        // and insert it into the set of "pending_shields" and therefore
        // (eventually) the private data tree.
        let mut note = TransparentNote::new(amount, secretHash);
        pending_shields.insert_from_public(inputs, &mut note);
    }

    // The shield function takes a public balance, and creates a commitment containing the amount of tokens
    // in the private context.
    fn redeemShield(
        inputs: PrivateContextInputs,
        amount: Field,
        secret: Field,
        owner: Field,
    ) -> distinct pub abi::PrivateCircuitPublicInputs {
        let storage = Storage::init();
        let pending_shields = storage.pending_shields;

        let mut context = Context::new(inputs, abi::hash_args([
            amount, secret, owner
        ]));

        // Assert that the note exists within the tree
        let mut public_note = TransparentNote::new_from_secret(amount, secret);

        // Ensure that the note exists in the tree
        pending_shields.assert_contains_note_hash(&mut context, &mut public_note);
        // The above call to `assert_contains()` also returns a modified note with
        // the header which is necessary for the next step (remove).

        // Set the nonce to nonzero so that the nullifier is treated as persistable
        // (non-transient) and so the private kernel does not attempt to match it to
        // a pending noteHash/commitment and squash them.
        // TODO(https://github.com/AztecProtocol/aztec-packages/issues/1386): remove
        // this hack once public kernel injects nonces.
        public_note.header.nonce = 1;

        // Consume note in secret!
        pending_shields.remove(&mut context, public_note);

        // Mint the tokens
        let balance = storage.balances.at(owner);
        send_note(&mut context, balance, amount, owner);

        context.finish()
    }

    fn unshieldTokens(
        inputs: PrivateContextInputs,
        amount: Field,
        owner: Field,
        recipient: Field,
    ) -> distinct pub abi::PrivateCircuitPublicInputs {
        let storage = Storage::init();
        let mut context = Context::new(inputs, abi::hash_args([
            amount, owner, recipient
        ]));

        // Remove user balance
        let sender_balance = storage.balances.at(owner);
        spend_notes(&mut context, sender_balance, amount, owner);

        // enqueue a public function to perform the public state update.
        let thisAddress = inputs.call_context.storage_contract_address;

        // addUnshieldedBalance selector (in decimal)
        // recompute by: `cast keccak addUnshieldedBalance(field,field)` -> convert to decimal
        let pubEntryPointSelector = 753269941;
        let _callStackItem1 = context.call_public_function(thisAddress, pubEntryPointSelector, [amount, recipient]);

        context.finish()
    }

    open fn addUnshieldedBalance(
        _inputs: PublicContextInputs,
        amount: Field,
        recipient: Field,
    ) {
        let storage = Storage::init();

        let recipient_balance = storage.public_balances.at(recipient);
        let current_balance = recipient_balance.read();
        let new_balance = current_balance + amount;
        recipient_balance.write(new_balance);
    }

    unconstrained fn getBalance(
        owner: Field,
    ) -> Field {
        let storage = Storage::init();
        let owner_balance = storage.balances.at(owner);

        balance_utils::get_balance(owner_balance.storage_slot)
    }

    // Computes note hash and nullifier.
    // Note 1: Needs to be defined by every contract producing logs.
    // Note 2: Having it in all the contracts gives us the ability to compute the note hash and nullifier differently for different kind of notes.
    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; VALUE_NOTE_LEN]) -> [Field; 4] {
        let note_header = NoteHeader { contract_address, nonce, storage_slot };
        if (storage_slot == 2) {
            note_utils::compute_note_hash_and_nullifier(TransparentNoteMethods, note_header, preimage)
        } else {
            note_utils::compute_note_hash_and_nullifier(ValueNoteMethods, note_header, preimage)
        }
    }

    unconstrained fn publicBalanceOf(
        owner: Field,
    ) -> Field {
        let storage = Storage::init();
        storage.public_balances.at(owner).read()
    }
}
