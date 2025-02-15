import { AztecNodeService } from '@aztec/aztec-node';
import { AztecRPCServer } from '@aztec/aztec-rpc';
import { AztecAddress, Fr, Wallet } from '@aztec/aztec.js';
import { DebugLogger } from '@aztec/foundation/log';
import { PendingCommitmentsContract } from '@aztec/noir-contracts/types';
import { AztecRPC, TxStatus } from '@aztec/types';

import { setup } from './fixtures/utils.js';

describe('e2e_pending_commitments_contract', () => {
  let aztecNode: AztecNodeService | undefined;
  let aztecRpcServer: AztecRPC;
  let wallet: Wallet;
  let accounts: AztecAddress[];
  let logger: DebugLogger;

  let contract: PendingCommitmentsContract;

  beforeEach(async () => {
    ({ aztecNode, aztecRpcServer, accounts, wallet, logger } = await setup(2));
  }, 100_000);

  afterEach(async () => {
    await aztecNode?.stop();
    if (aztecRpcServer instanceof AztecRPCServer) {
      await aztecRpcServer?.stop();
    }
  });

  const expectCommitmentsSquashedExcept = async (exceptFirstFew: number) => {
    const blockNum = await aztecNode!.getBlockHeight();
    const block = (await aztecNode!.getBlocks(blockNum, 1))[0];

    // all new commitments should be zero (should be squashed)
    for (let c = 0; c < exceptFirstFew; c++) {
      expect(block.newCommitments[c]).not.toEqual(Fr.ZERO);
    }

    for (let c = exceptFirstFew; c < block.newCommitments.length; c++) {
      expect(block.newCommitments[c]).toEqual(Fr.ZERO);
    }
  };

  const expectNullifiersSquashedExcept = async (exceptFirstFew: number) => {
    const blockNum = await aztecNode!.getBlockHeight();
    const block = (await aztecNode!.getBlocks(blockNum, 1))[0];

    // 0th nullifier should be nonzero (txHash), all others should be zero (should be squashed)
    for (let n = 0; n < exceptFirstFew + 1; n++) {
      logger(`Expecting nullifier ${n} to be nonzero`);
      expect(block.newNullifiers[n]).not.toEqual(Fr.ZERO); // 0th nullifier is txHash
    }
    for (let n = exceptFirstFew + 1; n < block.newNullifiers.length; n++) {
      expect(block.newNullifiers[n]).toEqual(Fr.ZERO);
    }
  };

  const deployContract = async () => {
    logger(`Deploying L2 contract...`);
    const tx = PendingCommitmentsContract.deploy(aztecRpcServer).send();
    const receipt = await tx.getReceipt();
    await tx.isMined({ interval: 0.1 });
    await tx.getReceipt();
    logger('L2 contract deployed');
    contract = await PendingCommitmentsContract.create(receipt.contractAddress!, wallet);
    return contract;
  };

  it('Noir function can "get" notes it just "inserted"', async () => {
    const mintAmount = 65n;
    const [owner] = accounts;

    const deployedContract = await deployContract();

    const tx = deployedContract.methods
      .test_insert_then_get_then_nullify_flat(mintAmount, owner)
      .send({ origin: owner });

    await tx.isMined({ interval: 0.1 });
    const receipt = await tx.getReceipt();
    expect(receipt.status).toBe(TxStatus.MINED);
  }, 60_000);

  it('Squash! Noir function can "create" and "nullify" note in the same TX', async () => {
    // Kernel will squash the noteHash and its nullifier.
    // Realistic way to describe this test is "Mint note A, then burn note A in the same transaction"
    const mintAmount = 65n;
    const [owner] = accounts;

    const deployedContract = await deployContract();

    const tx = deployedContract.methods
      .test_insert_then_get_then_nullify_all_in_nested_calls(
        mintAmount,
        owner,
        Fr.fromBuffer(deployedContract.methods.insert_note.selector),
        Fr.fromBuffer(deployedContract.methods.get_then_nullify_note.selector),
        Fr.fromBuffer(deployedContract.methods.get_note_zero_balance.selector),
      )
      .send({ origin: owner });

    await tx.isMined({ interval: 0.1 });
    const receipt = await tx.getReceipt();
    expect(receipt.status).toBe(TxStatus.MINED);

    await expectCommitmentsSquashedExcept(0);
    await expectNullifiersSquashedExcept(0);
  }, 60_000);

  it('Squash! Noir function can "create" 2 notes and "nullify" both in the same TX', async () => {
    // Kernel will squash both noteHashes and their nullifier.
    // Realistic way to describe this test is "Mint notes A and B, then burn both in the same transaction"
    const mintAmount = 65n;
    const [owner] = accounts;

    const deployedContract = await deployContract();

    const tx = deployedContract.methods
      .test_insert2_then_get2_then_nullify2_all_in_nested_calls(
        mintAmount,
        owner,
        Fr.fromBuffer(deployedContract.methods.insert_note.selector),
        Fr.fromBuffer(deployedContract.methods.get_then_nullify_note.selector),
        //Fr.fromBuffer(deployedContract.methods.get_note_zero_balance.selector),
      )
      .send({ origin: owner });

    await tx.isMined({ interval: 0.1 });
    const receipt = await tx.getReceipt();
    expect(receipt.status).toBe(TxStatus.MINED);

    await expectCommitmentsSquashedExcept(0);
    await expectNullifiersSquashedExcept(0);
  }, 60_000);

  it('Squash! Noir function can "create" 2 notes and "nullify" 1 in the same TX (kernel will squash one note + nullifier)', async () => {
    // Kernel will squash one noteHash and its nullifier.
    // The other note will become persistent!
    // Realistic way to describe this test is "Mint notes A and B, then burn note A in the same transaction"
    const mintAmount = 65n;
    const [owner] = accounts;

    const deployedContract = await deployContract();

    const tx = deployedContract.methods
      .test_insert2_then_get2_then_nullify1_all_in_nested_calls(
        mintAmount,
        owner,
        Fr.fromBuffer(deployedContract.methods.insert_note.selector),
        Fr.fromBuffer(deployedContract.methods.get_then_nullify_note.selector),
      )
      .send({ origin: owner });

    await tx.isMined({ interval: 0.1 });
    const receipt = await tx.getReceipt();
    expect(receipt.status).toBe(TxStatus.MINED);

    await expectCommitmentsSquashedExcept(1);
    await expectNullifiersSquashedExcept(0);
  }, 60_000);

  it('Squash! Noir function can nullify a pending note and a persistent in the same TX', async () => {
    // Create 1 note in isolated TX.
    // Then, in a separate TX, create 1 new note and nullify BOTH notes.
    // In this second TX, the kernel will squash one note + nullifier,
    // but the nullifier for the persistent note (from the first TX) will itself become persistent.
    // Realistic way to describe this test is "Mint note A, then burn note A in the same transaction"
    const mintAmount = 65n;
    const [owner] = accounts;

    const deployedContract = await deployContract();

    // create persistent note
    const tx0 = deployedContract.methods.insert_note(mintAmount, owner).send({ origin: owner });

    await tx0.isMined({ interval: 0.1 });
    const receipt0 = await tx0.getReceipt();
    expect(receipt0.status).toBe(TxStatus.MINED);

    await expectCommitmentsSquashedExcept(1); // first TX just creates 1 persistent note
    await expectNullifiersSquashedExcept(0);

    // create another note, and nullify it and AND nullify the above-created note in the same TX
    const tx1 = deployedContract.methods
      .test_insert1_then_get2_then_nullify2_all_in_nested_calls(
        mintAmount,
        owner,
        Fr.fromBuffer(deployedContract.methods.insert_note.selector),
        Fr.fromBuffer(deployedContract.methods.get_then_nullify_note.selector),
        Fr.fromBuffer(deployedContract.methods.get_note_zero_balance.selector),
      )
      .send({ origin: owner });

    await tx1.isMined({ interval: 0.1 });
    const receipt1 = await tx1.getReceipt();
    expect(receipt1.status).toBe(TxStatus.MINED);

    // second TX creates 1 note, but it is squashed!
    await expectCommitmentsSquashedExcept(0);
    // the nullifier corresponding to this transient note is squashed, but the
    // other nullifier corresponding to the persistent note becomes persistent itself.
    await expectNullifiersSquashedExcept(1);
  }, 60_000);

  // TODO(https://github.com/AztecProtocol/aztec-packages/issues/836): test nullify & squash of pending notes
  // TODO(https://github.com/AztecProtocol/aztec-packages/issues/892): test expected kernel failures if transient reads (or their hints) don't match
  // TODO(https://github.com/AztecProtocol/aztec-packages/issues/836): test expected kernel failures if nullifiers (or their hints) don't match
  // TODO(https://github.com/AztecProtocol/aztec-packages/issues/839): test creation, getting, nullifying of multiple notes
  // TODO(https://github.com/AztecProtocol/aztec-packages/issues/1242): test nullifying a note created in a previous transaction and
  //                                                                    get_notes in the same transaction should not return it.
});
