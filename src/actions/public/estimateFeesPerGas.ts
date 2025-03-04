import type { Client } from '../../clients/createClient.js'
import type { Transport } from '../../clients/transports/createTransport.js'
import {
  BaseFeeScalarError,
  Eip1559FeesNotSupportedError,
} from '../../errors/fee.js'
import type { Block } from '../../types/block.js'
import type {
  Chain,
  ChainEstimateFeesPerGasFnParameters,
  ChainFeesFnParameters,
} from '../../types/chain.js'
import type { GetChain } from '../../types/chain.js'
import type {
  FeeValuesEIP1559,
  FeeValuesLegacy,
  FeeValuesType,
} from '../../types/fee.js'
import type { PrepareRequestParameters } from '../../utils/transaction/prepareRequest.js'
import { internal_estimateMaxPriorityFeePerGas } from './estimateMaxPriorityFeePerGas.js'
import { getBlock } from './getBlock.js'
import { getGasPrice } from './getGasPrice.js'

export type EstimateFeesPerGasParameters<
  chain extends Chain | undefined = Chain | undefined,
  chainOverride extends Chain | undefined = Chain | undefined,
  type extends FeeValuesType = FeeValuesType,
> = {
  /**
   * The type of fee values to return.
   *
   * - `legacy`: Returns the legacy gas price.
   * - `eip1559`: Returns the max fee per gas and max priority fee per gas.
   *
   * @default 'eip1559'
   */
  type?: type | FeeValuesType
} & GetChain<chain, chainOverride>

export type EstimateFeesPerGasReturnType<
  type extends FeeValuesType = FeeValuesType,
> =
  | (type extends 'legacy' ? FeeValuesLegacy : never)
  | (type extends 'eip1559' ? FeeValuesEIP1559 : never)

/**
 * Returns an estimate for the fees per gas (in wei) for a
 * transaction to be likely included in the next block.
 * Defaults to [`chain.fees.estimateFeesPerGas`](/docs/clients/chains.html#fees-estimatefeespergas) if set.
 *
 * - Docs: https://viem.sh/docs/actions/public/estimateFeesPerGas.html
 *
 * @param client - Client to use
 * @param parameters - {@link EstimateFeesPerGasParameters}
 * @returns An estimate (in wei) for the fees per gas. {@link EstimateFeesPerGasReturnType}
 *
 * @example
 * import { createPublicClient, http } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { estimateFeesPerGas } from 'viem/actions'
 *
 * const client = createPublicClient({
 *   chain: mainnet,
 *   transport: http(),
 * })
 * const maxPriorityFeePerGas = await estimateFeesPerGas(client)
 * // { maxFeePerGas: ..., maxPriorityFeePerGas: ... }
 */
export async function estimateFeesPerGas<
  chain extends Chain | undefined,
  chainOverride extends Chain | undefined,
  type extends FeeValuesType = 'eip1559',
>(
  client: Client<Transport, chain>,
  args?: EstimateFeesPerGasParameters<chain, chainOverride, type>,
): Promise<EstimateFeesPerGasReturnType<type>> {
  return internal_estimateFeesPerGas(client, args as any)
}

export async function internal_estimateFeesPerGas<
  chain extends Chain | undefined,
  chainOverride extends Chain | undefined,
  type extends FeeValuesType = 'eip1559',
>(
  client: Client<Transport, chain>,
  args: EstimateFeesPerGasParameters<chain, chainOverride, type> & {
    block?: Block
    request?: PrepareRequestParameters
  },
): Promise<EstimateFeesPerGasReturnType<type>> {
  const {
    block: block_,
    chain = client.chain,
    request,
    type = 'eip1559',
  } = args || {}

  const baseFeeMultiplier = await (async () => {
    if (typeof chain?.fees?.baseFeeMultiplier === 'function')
      return chain.fees.baseFeeMultiplier({
        block: block_ as Block,
        client,
        request,
      } as ChainFeesFnParameters)
    return chain?.fees?.baseFeeMultiplier ?? 1.2
  })()
  if (baseFeeMultiplier < 1) throw new BaseFeeScalarError()

  const decimals = baseFeeMultiplier.toString().split('.')[1].length
  const denominator = 10 ** decimals
  const multiply = (base: bigint) =>
    (base * BigInt(baseFeeMultiplier * denominator)) / BigInt(denominator)

  const block = block_ ? block_ : await getBlock(client)

  if (typeof chain?.fees?.estimateFeesPerGas === 'function')
    return chain.fees.estimateFeesPerGas({
      block: block_ as Block,
      client,
      multiply,
      request,
      type,
    } as ChainEstimateFeesPerGasFnParameters) as unknown as EstimateFeesPerGasReturnType<type>

  if (type === 'eip1559') {
    if (typeof block.baseFeePerGas !== 'bigint')
      throw new Eip1559FeesNotSupportedError()

    const maxPriorityFeePerGas = request?.maxPriorityFeePerGas
      ? request.maxPriorityFeePerGas
      : await internal_estimateMaxPriorityFeePerGas(
          client as Client<Transport, Chain>,
          {
            block,
            chain,
            request,
          },
        )

    const baseFeePerGas = multiply(block.baseFeePerGas)
    const maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas

    return {
      maxFeePerGas,
      maxPriorityFeePerGas,
    } as EstimateFeesPerGasReturnType<type>
  }

  const gasPrice = multiply(await getGasPrice(client))
  return {
    gasPrice,
  } as EstimateFeesPerGasReturnType<type>
}
