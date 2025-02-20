import Router from '@koa/router';
import Transaction from 'arweave/node/lib/transaction';
import Arweave from 'arweave';
import { GQLTagInterface, SmartWeaveTags } from 'warp-contracts';
import Bundlr from '@bundlr-network/client';
import { evalType } from '../../tasks/contractsMetadata';
import { getCachedNetworkData } from '../../tasks/networkInfoCache';
import { BUNDLR_NODE2_URL } from '../../../constants';

export async function deployContractRoute(ctx: Router.RouterContext) {
  const { logger, gatewayDb, arweave, bundlr } = ctx;

  const contractTx: Transaction = new Transaction({ ...ctx.request.body.contractTx });
  let srcTx: Transaction | null = null;
  if (ctx.request.body.srcTx) {
    srcTx = new Transaction({ ...ctx.request.body.srcTx });
  }
  logger.debug('New deploy contract transaction', contractTx.id);

  const originalOwner = contractTx.owner;
  const originalAddress = await arweave.wallets.ownerToAddress(originalOwner);
  const contractTags = prepareTags(contractTx, originalAddress);

  try {
    let srcTxId, srcContentType, src, srcBinary, srcWasmLang, bundlerSrcTxId, srcTxOwner;

    if (srcTx) {
      srcTxId = srcTx.id;
      srcTxOwner = await arweave.wallets.ownerToAddress(srcTx.owner);
      const srcTags = prepareTags(srcTx, originalAddress);
      srcContentType = tagValue(SmartWeaveTags.CONTENT_TYPE, srcTags);
      srcWasmLang = tagValue(SmartWeaveTags.WASM_LANG, srcTags);
      if (srcContentType == 'application/javascript') {
        src = Arweave.utils.bufferToString(srcTx.data);
      } else {
        srcBinary = Buffer.from(srcTx.data);
      }
      const response = await uploadToBundlr(srcTx, bundlr, srcTags);
      bundlerSrcTxId = response.bTx.id;
      logger.debug('Src Tx successfully bundled', {
        id: srcTxId,
        bundled_tx_id: bundlerSrcTxId,
      });
    } else {
      srcTxId = tagValue(SmartWeaveTags.CONTRACT_SRC_TX_ID, contractTags);
      // maybe ad some sanity check here - whether the src is already indexed by the gateway?
    }

    const { bTx: bundlerContractTx } = await uploadToBundlr(contractTx, bundlr, contractTags);
    logger.debug('Contract Tx successfully bundled', {
      id: contractTx.id,
      bundled_tx_id: bundlerContractTx.id,
    });

    let initStateRaw = tagValue(SmartWeaveTags.INIT_STATE, contractTags);
    if (!initStateRaw) {
      initStateRaw = Arweave.utils.bufferToString(contractTx.data);
    }
    const initState = JSON.parse(initStateRaw);
    const type = evalType(initState);

    const insert = {
      contract_id: contractTx.id,
      src_tx_id: srcTxId,
      init_state: initState,
      owner: originalAddress,
      type: type,
      pst_ticker: type == 'pst' ? initState?.ticker : null,
      pst_name: type == 'pst' ? initState?.name : null,
      block_height: getCachedNetworkData().cachedNetworkInfo.height,
      block_timestamp: getCachedNetworkData().cachedBlockInfo.timestamp,
      content_type: tagValue(SmartWeaveTags.CONTENT_TYPE, contractTags),
      contract_tx: { ...contractTx.toJSON(), data: null },
      bundler_contract_tx_id: bundlerContractTx.id,
      bundler_contract_node: BUNDLR_NODE2_URL,
      bundler_contract_tags: JSON.stringify(contractTags),
    };

    await gatewayDb('contracts').insert(insert);

    if (srcTx) {
      let contracts_src_insert: any = {
        src_tx_id: srcTxId,
        owner: srcTxOwner,
        src: src || null,
        src_content_type: srcContentType,
        src_binary: srcBinary || null,
        src_wasm_lang: srcWasmLang || null,
        bundler_src_tx_id: bundlerSrcTxId,
        bundler_src_node: BUNDLR_NODE2_URL,
        src_tx: { ...srcTx.toJSON(), data: null },
      };

      await gatewayDb('contracts_src').insert(contracts_src_insert).onConflict('src_tx_id').ignore();
    }

    logger.info('Contract successfully bundled.');

    ctx.body = {
      contractId: contractTx.id,
      bundleContractId: bundlerContractTx.id,
      srcTxId: srcTxId,
      bundleSrcId: bundlerSrcTxId,
    };
  } catch (e) {
    logger.error('Error while inserting bundled transaction');
    logger.error(e);
    ctx.status = 500;
    ctx.body = { message: e };
  }
}

function tagValue(name: string, tags: GQLTagInterface[]): string | undefined {
  const tag = tags.find((t) => t.name == name);
  return tag?.value;
}

function prepareTags(transaction: Transaction, originalAddress: string): GQLTagInterface[] {
  const decodedTags: GQLTagInterface[] = [];

  transaction.tags.forEach((tag) => {
    const key = tag.get('name', { decode: true, string: true });
    const value = tag.get('value', { decode: true, string: true });
    decodedTags.push({
      name: key,
      value: value,
    });
  });

  const tags = [
    { name: 'Uploader', value: 'RedStone' },
    { name: 'Uploader-Contract-Owner', value: originalAddress },
    { name: 'Uploader-Tx-Id', value: transaction.id },
    { name: 'Uploader-Bundler', value: BUNDLR_NODE2_URL },
    ...decodedTags,
  ];

  return tags;
}

async function uploadToBundlr(transaction: Transaction, bundlr: Bundlr, tags: GQLTagInterface[]) {
  const bTx = bundlr.createTransaction(JSON.stringify(transaction), { tags });
  await bTx.sign();
  const bundlrResponse = await bTx.upload();

  return { bTx, bundlrResponse };
}
