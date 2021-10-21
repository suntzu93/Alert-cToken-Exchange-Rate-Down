import BigNumber from 'bignumber.js'
import {
  Finding,
  HandleTransaction,
  TransactionEvent,
  FindingSeverity,
  FindingType,
  getJsonRpcUrl
} from 'forta-agent'
import { AbiItem } from 'web3-utils'
import { ABI, CTOKEN_CONTRACTS, APPROVE_FUNCTION } from './const'
import Web3 from 'web3';

const web3 = new Web3(getJsonRpcUrl());
// To save previous rate

/**
 * Return token contract info includes token name and contract address
 * @param fromAddress 
 * @param toAddress 
 * @returns 
 */
function getCTokenContractInfo(fromAddress: string, toAddress: string | null): [string, string] | null {
  for (let [k, v] of Array.from(CTOKEN_CONTRACTS.entries())) {
    if (v === fromAddress
      || (toAddress != null && v === toAddress)) {
      return [k, v];
    }
  }

  return null;
}

/**
 * Get current rate exchange from contract. More info https://etherscan.io/address/0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5#code#L1318
 * @param ctAddrs 
 * @returns error : -1, success : exchange rate scaled by 1e28
 */
const getExchangeRate = async (ctAddrs: string, blockNumber: number): Promise<number> => {
  var cDAIContract = new web3.eth.Contract(ABI as AbiItem[], ctAddrs.toString());
  var exchangeRate = await cDAIContract.methods.exchangeRateCurrent().call({}, blockNumber, function (err: any, res: any) {
    if (!err) {
      // cTokens are each 8 decimals => Take the raw number and divide by 1e(18+underlying-8) = 1e28
      return res;
    }
  })
  
  return exchangeRate
}

const handleTransaction: HandleTransaction = async (txEvent: TransactionEvent) => {
  const findings: Finding[] = []

  const toAddress = txEvent.to;
  const fromAddress = txEvent.from;
  // cTokenContract[0] : token name
  // cTokenContract[1] : contract address
  const cTokenContract = getCTokenContractInfo(fromAddress, toAddress);
  //If cTOKEN not involved 
  if (cTokenContract == null) return findings;

  //Ignore approve function
  const approveEvent = txEvent.filterEvent(APPROVE_FUNCTION)
  if (approveEvent.length) return findings;

  const tokenName = cTokenContract[0];
  const contractAddress = cTokenContract[1];

  const currentExchangeRate: number = await getExchangeRate(contractAddress, txEvent.blockNumber).then(res => { return res });
  const previousExchangeRate: number = await getExchangeRate(contractAddress, txEvent.blockNumber - 1).then(res => { return res });

  if (currentExchangeRate - previousExchangeRate > 0) return findings;

  findings.push(Finding.fromObject({
    name: `${tokenName} exchange rate down`,
    description: `${tokenName} exchange rate goes down from ${previousExchangeRate} to ${currentExchangeRate}`,
    alertId: `FORTA-CTOKEN-RATE-DOWN`,
    severity: FindingSeverity.Medium,
    type: FindingType.Suspicious,
    metadata: {
      previousRate: previousExchangeRate.toString(),
      currentRate: currentExchangeRate.toString()
    }
  }));

  return findings
}

export default {
  handleTransaction
}