import { CommitmentDataOracleInputs, DBOracle, MessageLoadOracleInputs } from '@aztec/acir-simulator';
import { AztecAddress, CircuitsWasm, EthAddress, Fr, PartialAddress, PrivateKey, PublicKey } from '@aztec/circuits.js';
import { siloCommitment } from '@aztec/circuits.js/abis';
import { FunctionAbi } from '@aztec/foundation/abi';
import { DataCommitmentProvider, KeyStore, L1ToL2MessageProvider } from '@aztec/types';

import { ContractDataOracle } from '../contract_data_oracle/index.js';
import { Database } from '../database/index.js';

/**
 * A data oracle that provides information needed for simulating a transaction.
 */
export class SimulatorOracle implements DBOracle {
  constructor(
    private contractDataOracle: ContractDataOracle,
    private db: Database,
    private keyStore: KeyStore,
    private l1ToL2MessageProvider: L1ToL2MessageProvider,
    private dataTreeProvider: DataCommitmentProvider,
  ) {}

  getSecretKey(_contractAddress: AztecAddress, pubKey: PublicKey): Promise<PrivateKey> {
    return this.keyStore.getAccountPrivateKey(pubKey);
  }

  async getPublicKey(address: AztecAddress): Promise<[PublicKey, PartialAddress]> {
    const result = await this.db.getPublicKeyAndPartialAddress(address);
    if (!result)
      throw new Error(
        `Unknown public key for address ${address.toString()}. Add public key to Aztec RPC server by calling server.addPublicKeyAndPartialAddress(...)`,
      );
    return result;
  }

  async getNotes(contractAddress: AztecAddress, storageSlot: Fr) {
    const noteDaos = await this.db.getNoteSpendingInfo(contractAddress, storageSlot);
    return noteDaos.map(({ contractAddress, storageSlot, nonce, notePreimage, siloedNullifier, index }) => ({
      contractAddress,
      storageSlot,
      nonce,
      preimage: notePreimage.items,
      siloedNullifier,
      // RPC Client can use this index to get full MembershipWitness
      index,
    }));
  }

  async getFunctionABI(contractAddress: AztecAddress, functionSelector: Buffer): Promise<FunctionAbi> {
    return await this.contractDataOracle.getFunctionAbi(contractAddress, functionSelector);
  }

  async getPortalContractAddress(contractAddress: AztecAddress): Promise<EthAddress> {
    return await this.contractDataOracle.getPortalContractAddress(contractAddress);
  }

  /**
   * Retrieves the L1ToL2Message associated with a specific message key
   * Throws an error if the message key is not found
   *
   * @param msgKey - The key of the message to be retrieved
   * @returns A promise that resolves to the message data, a sibling path and the
   *          index of the message in the l1ToL2MessagesTree
   */
  async getL1ToL2Message(msgKey: Fr): Promise<MessageLoadOracleInputs> {
    const messageAndIndex = await this.l1ToL2MessageProvider.getL1ToL2MessageAndIndex(msgKey);
    const message = messageAndIndex.message.toFieldArray();
    const index = messageAndIndex.index;
    const siblingPath = await this.l1ToL2MessageProvider.getL1ToL2MessagesTreePath(index);
    return {
      message,
      siblingPath: siblingPath.toFieldArray(),
      index,
    };
  }

  /**
   * Retrieves the noir oracle data required to prove existence of a given commitment.
   * @param contractAddress - The contract Address.
   * @param innerCommitment - The key of the message being fetched.
   * @returns - A promise that resolves to the commitment data, a sibling path and the
   *            index of the message in the private data tree.
   */
  async getCommitmentOracle(contractAddress: AztecAddress, innerCommitment: Fr): Promise<CommitmentDataOracleInputs> {
    const siloedCommitment = siloCommitment(await CircuitsWasm.get(), contractAddress, innerCommitment);
    const index = await this.dataTreeProvider.findCommitmentIndex(siloedCommitment.toBuffer());
    if (!index) throw new Error('Commitment not found');

    const siblingPath = await this.dataTreeProvider.getDataTreePath(index);
    return await Promise.resolve({
      commitment: siloedCommitment,
      siblingPath: siblingPath.toFieldArray(),
      index,
    });
  }
}
