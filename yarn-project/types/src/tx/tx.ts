import {
  AztecAddress,
  Fr,
  KernelCircuitPublicInputs,
  MAX_PUBLIC_CALL_STACK_LENGTH_PER_TX,
  PartialContractAddress,
  Proof,
  PublicCallRequest,
} from '@aztec/circuits.js';
import { serializeToBuffer } from '@aztec/circuits.js/utils';
import { arrayNonEmptyLength } from '@aztec/foundation/collection';
import { BufferReader, numToUInt32BE } from '@aztec/foundation/serialize';

import { EncodedContractFunction } from '../contract_data.js';
import { TxL2Logs } from '../logs/tx_l2_logs.js';
import { TxHash } from './tx_hash.js';

/**
 * The interface of an L2 transaction.
 */
export class Tx {
  constructor(
    /**
     * Output of the private kernel circuit for this tx.
     */
    public readonly data: KernelCircuitPublicInputs,
    /**
     * Proof from the private kernel circuit.
     */
    public readonly proof: Proof,
    /**
     * Encrypted logs generated by the tx.
     */
    public readonly encryptedLogs: TxL2Logs,
    /**
     * Unencrypted logs generated by the tx.
     */
    public readonly unencryptedLogs: TxL2Logs,
    /**
     * New public functions made available by this tx.
     */
    public readonly newContractPublicFunctions: EncodedContractFunction[],
    /**
     * Enqueued public functions from the private circuit to be run by the sequencer.
     * Preimages of the public call stack entries from the private kernel circuit output.
     */
    public readonly enqueuedPublicFunctionCalls: PublicCallRequest[],
  ) {
    if (this.unencryptedLogs.functionLogs.length < this.encryptedLogs.functionLogs.length) {
      // This check is present because each private function invocation creates encrypted FunctionL2Logs object and
      // both public and private function invocations create unencrypted FunctionL2Logs object. Hence "num unencrypted"
      // >= "num encrypted".
      throw new Error(
        `Number of function logs in unencrypted logs (${this.unencryptedLogs.functionLogs.length}) has to be equal
        or larger than number function logs in encrypted logs (${this.encryptedLogs.functionLogs.length})`,
      );
    }

    const kernelPublicCallStackSize =
      data?.end.publicCallStack && arrayNonEmptyLength(data.end.publicCallStack, item => item.isZero());
    if (kernelPublicCallStackSize && kernelPublicCallStackSize > (enqueuedPublicFunctionCalls?.length ?? 0)) {
      throw new Error(
        `Missing preimages for enqueued public function calls in kernel circuit public inputs (expected
          ${kernelPublicCallStackSize}, got ${enqueuedPublicFunctionCalls?.length})`,
      );
    }
  }

  /**
   * Deserializes the Tx object from a Buffer.
   * @param buffer - Buffer or BufferReader object to deserialize.
   * @returns An instance of Tx.
   */
  static fromBuffer(buffer: Buffer | BufferReader): Tx {
    const reader = BufferReader.asReader(buffer);
    return new Tx(
      reader.readObject(KernelCircuitPublicInputs),
      reader.readObject(Proof),
      reader.readObject(TxL2Logs),
      reader.readObject(TxL2Logs),
      reader.readArray(reader.readNumber(), EncodedContractFunction),
      reader.readArray(MAX_PUBLIC_CALL_STACK_LENGTH_PER_TX, PublicCallRequest),
    );
  }

  /**
   * Serializes the Tx object into a Buffer.
   * @returns Buffer representation of the Tx object.
   */
  toBuffer() {
    return serializeToBuffer([
      this.data,
      this.proof,
      this.encryptedLogs,
      this.unencryptedLogs,
      // number of new contract public functions is not constant so we need to include it in the serialization
      numToUInt32BE(this.newContractPublicFunctions.length),
      this.newContractPublicFunctions,
      this.enqueuedPublicFunctionCalls,
    ]);
  }

  /**
   * Convert a Tx class object to a plain JSON object.
   * @returns A plain object with Tx properties.
   */
  public toJSON() {
    return {
      data: this.data.toBuffer().toString('hex'),
      encryptedLogs: this.encryptedLogs.toBuffer().toString('hex'),
      unencryptedLogs: this.unencryptedLogs.toBuffer().toString('hex'),
      proof: this.proof.toBuffer().toString('hex'),
      newContractPublicFunctions: this.newContractPublicFunctions.map(f => f.toBuffer().toString('hex')) ?? [],
      enqueuedPublicFunctions: this.enqueuedPublicFunctionCalls.map(f => f.toBuffer().toString('hex')) ?? [],
    };
  }

  /**
   * Convert a plain JSON object to a Tx class object.
   * @param obj - A plain Tx JSON object.
   * @returns A Tx class object.
   */
  public static fromJSON(obj: any) {
    const publicInputs = KernelCircuitPublicInputs.fromBuffer(Buffer.from(obj.data, 'hex'));
    const encryptedLogs = TxL2Logs.fromBuffer(Buffer.from(obj.encryptedLogs, 'hex'));
    const unencryptedLogs = TxL2Logs.fromBuffer(Buffer.from(obj.unencryptedLogs, 'hex'));
    const proof = Buffer.from(obj.proof, 'hex');
    const newContractPublicFunctions = obj.newContractPublicFunctions
      ? obj.newContractPublicFunctions.map((x: string) => EncodedContractFunction.fromBuffer(Buffer.from(x, 'hex')))
      : [];
    const enqueuedPublicFunctions = obj.enqueuedPublicFunctions
      ? obj.enqueuedPublicFunctions.map((x: string) => PublicCallRequest.fromBuffer(Buffer.from(x, 'hex')))
      : [];
    return new Tx(
      publicInputs,
      Proof.fromBuffer(proof),
      encryptedLogs,
      unencryptedLogs,
      newContractPublicFunctions,
      enqueuedPublicFunctions,
    );
  }

  /**
   * Construct & return transaction hash.
   * @returns The transaction's hash.
   */
  getTxHash(): Promise<TxHash> {
    // Private kernel functions are executed client side and for this reason tx hash is already set as first nullifier
    const firstNullifier = this.data?.end.newNullifiers[0];
    if (!firstNullifier) throw new Error(`Cannot get tx hash since first nullifier is missing`);
    return Promise.resolve(new TxHash(firstNullifier.toBuffer()));
  }

  /**
   * Convenience function to get array of hashes for an array of txs.
   * @param txs - The txs to get the hashes from.
   * @returns The corresponding array of hashes.
   */
  static async getHashes(txs: Tx[]): Promise<TxHash[]> {
    return await Promise.all(txs.map(tx => tx.getTxHash()));
  }

  /**
   * Clones a tx, making a deep copy of all fields.
   * @param tx - The transaction to be cloned.
   * @returns The cloned transaction.
   */
  static clone(tx: Tx): Tx {
    const publicInputs = KernelCircuitPublicInputs.fromBuffer(tx.data.toBuffer());
    const proof = Proof.fromBuffer(tx.proof.toBuffer());
    const encryptedLogs = TxL2Logs.fromBuffer(tx.encryptedLogs.toBuffer());
    const unencryptedLogs = TxL2Logs.fromBuffer(tx.unencryptedLogs.toBuffer());
    const publicFunctions = tx.newContractPublicFunctions.map(x => {
      return EncodedContractFunction.fromBuffer(x.toBuffer());
    });
    const enqueuedPublicFunctions = tx.enqueuedPublicFunctionCalls.map(x => {
      return PublicCallRequest.fromBuffer(x.toBuffer());
    });
    return new Tx(publicInputs, proof, encryptedLogs, unencryptedLogs, publicFunctions, enqueuedPublicFunctions);
  }
}

/**
 * Wrapper class for a contract deployment transaction.
 * Also contains the contract partial address
 */
export class ContractDeploymentTx {
  public constructor(
    /**
     * The Tx being wrapped.
     */
    public readonly tx: Tx,

    /**
     * The partially conputed contract address.
     */
    public readonly partialContractAddress: PartialContractAddress,

    /**
     * The complete contract address.
     */
    public readonly contractAddress: AztecAddress,
  ) {}

  toJSON() {
    return {
      tx: this.tx.toJSON(),
      partialContractAddress: this.partialContractAddress.toBuffer().toString(),
      contractAddress: this.contractAddress.toBuffer().toString(),
    };
  }

  static fromJSON(obj: any) {
    return new ContractDeploymentTx(
      Tx.fromJSON(obj.tx),
      Fr.fromBuffer(Buffer.from(obj.partialContractAddress, 'hex')),
      AztecAddress.fromBuffer(Buffer.from(obj.contractAddress, 'hex')),
    );
  }
}
