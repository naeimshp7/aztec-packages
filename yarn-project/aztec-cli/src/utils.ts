import { AztecAddress, AztecRPC } from '@aztec/aztec.js';
import { createEthereumChain, deployL1Contracts } from '@aztec/ethereum';
import { ContractAbi } from '@aztec/foundation/abi';
import { DebugLogger, LogFn } from '@aztec/foundation/log';

import fs from 'fs';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';

import { encodeArgs } from './cli_encoder.js';

/**
 * Helper type to dynamically import contarcts.
 */
interface ArtifactsType {
  [key: string]: ContractAbi;
}

/**
 * Helper to get an ABI function or throw error if it doesn't exist.
 * @param abi - Contract's ABI in JSON format.
 * @param fnName - Function name to be found.
 * @returns The function's ABI.
 */
export function getAbiFunction(abi: ContractAbi, fnName: string) {
  const fn = abi.functions.find(({ name }) => name === fnName);
  if (!fn) {
    throw Error(`Function ${fnName} not found in contract ABI.`);
  }
  return fn;
}

/**
 * Function to execute the 'deployRollupContracts' command.
 * @param rpcUrl - The RPC URL of the ethereum node.
 * @param apiKey - The api key of the ethereum node endpoint.
 * @param privateKey - The private key to be used in contract deployment.
 * @param mnemonic - The mnemonic to be used in contract deployment.
 */
export async function deployAztecContracts(
  rpcUrl: string,
  apiKey: string,
  privateKey: string,
  mnemonic: string,
  debugLogger: DebugLogger,
) {
  const account = !privateKey ? mnemonicToAccount(mnemonic!) : privateKeyToAccount(`0x${privateKey}`);
  const chain = createEthereumChain(rpcUrl, apiKey);
  return await deployL1Contracts(chain.rpcUrl, account, chain.chainInfo, debugLogger);
}

/**
 * Gets all contracts available in \@aztec/noir-contracts.
 * @returns The contract ABIs.
 */
export async function getExampleContractArtifacts() {
  const artifacts: ArtifactsType = await import('@aztec/noir-contracts/artifacts');
  return artifacts;
}

/**
 * Reads a file and converts it to an Aztec Contract ABI.
 * @param fileDir - The directory of the compiled contract ABI.
 * @returns The parsed ContractABI.
 */
export async function getContractAbi(fileDir: string, log: LogFn) {
  // first check if it's a noir-contracts example
  let contents: string;
  const artifacts = await getExampleContractArtifacts();
  if (artifacts[fileDir]) {
    return artifacts[fileDir] as ContractAbi;
  }

  try {
    contents = fs.readFileSync(fileDir, 'utf8');
  } catch {
    throw Error(`Contract ${fileDir} not found`);
  }

  // if not found, try reading as path directly
  let contractAbi: ContractAbi;
  try {
    contractAbi = JSON.parse(contents) as ContractAbi;
  } catch (err) {
    log('Invalid file used. Please try again.');
    throw err;
  }
  return contractAbi;
}

/**
 * Utility to select a TX sender either from user input
 * or from the first account that is found in an Aztec RPC instance.
 * @param client - The Aztec RPC instance that will be checked for an account.
 * @param _from - The user input.
 * @returns An Aztec address. Will throw if one can't be found in either options.
 */
export async function getTxSender(client: AztecRPC, _from?: string) {
  let from: AztecAddress;
  if (_from) {
    try {
      from = AztecAddress.fromString(_from);
    } catch {
      throw new Error(`Invalid option 'from' passed: ${_from}`);
    }
  } else {
    const accounts = await client.getAccounts();
    if (!accounts.length) {
      throw new Error('No accounts found in Aztec RPC insance.');
    }
    from = accounts[0];
  }
  return from;
}

/**
 * Performs necessary checks, conversions & operations to call a contract fn from the CLI.
 * @param contractFile - Directory of the compiled contract ABI.
 * @param _contractAddress - Aztec Address of the contract.
 * @param functionName - Name of the function to be called.
 * @param _functionArgs - Arguments to call the function with.
 * @param log - Logger instance that will output to the CLI
 * @returns Formatted contract address, function arguments and caller's aztec address.
 */
export async function prepTx(
  contractFile: string,
  _contractAddress: string,
  functionName: string,
  _functionArgs: string[],
  log: LogFn,
) {
  let contractAddress;
  try {
    contractAddress = AztecAddress.fromString(_contractAddress);
  } catch {
    throw new Error(`Unable to parse contract address ${_contractAddress}.`);
  }
  const contractAbi = await getContractAbi(contractFile, log);
  const functionAbi = getAbiFunction(contractAbi, functionName);
  const functionArgs = encodeArgs(_functionArgs, functionAbi.parameters);

  return { contractAddress, functionArgs, contractAbi };
}
