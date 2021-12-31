import Router from "@koa/router";
import {Benchmark} from "redstone-smartweave";

const MAX_INTERACTIONS_PER_PAGE = 5000;

export async function interactionsRoute(ctx: Router.RouterContext) {
  const {logger, gatewayDb} = ctx;

  const {contractId, confirmationStatus, page, limit, from, to, totalCount} = ctx.query;

  logger.debug("Interactions route", {
    contractId,
    confirmationStatus,
    page,
    limit,
    from,
    to,
    totalCount
  });

  const parsedPage = page ? parseInt(page as string) : 1;

  const parsedLimit = limit ? Math.min(parseInt(limit as string), MAX_INTERACTIONS_PER_PAGE) : MAX_INTERACTIONS_PER_PAGE;
  const offset = parsedPage ? (parsedPage - 1) * parsedLimit : 0;

  const parsedConfirmationStatus = confirmationStatus
    ? confirmationStatus == "not_corrupted"
      ? ['confirmed', 'not_processed'] : [confirmationStatus]
    : undefined;

  const bindings: any[] = [];
  bindings.push(contractId);
  // cannot use IN with bindings https://github.com/knex/knex/issues/791
  // parsedConfirmationStatus && bindings.push(parsedConfirmationStatus)
  from && bindings.push(from as string);
  to && bindings.push(to as string);
  parsedPage && bindings.push(parsedLimit);
  parsedPage && bindings.push(offset);

  try {
    const benchmark = Benchmark.measure();
    const result: any = await gatewayDb.raw(
      `
          SELECT interaction,
                 confirmation_status,
                 confirming_peer,
                 confirmations,
                 count(*) OVER () AS total
          FROM interactions
          WHERE contract_id = ? ${parsedConfirmationStatus ? ` AND confirmation_status IN (${parsedConfirmationStatus.map(status => `'${status}'`).join(', ')})` : ''} ${from ? ' AND block_height >= ?' : ''} ${to ? ' AND block_height <= ?' : ''}
          ORDER BY block_height DESC, interaction_id DESC ${parsedPage ? ' LIMIT ? OFFSET ?' : ''};
      `, bindings
    );

    const totalInteractions: any = totalCount == 'true' && await gatewayDb.raw(
      `
          SELECT count(case when confirmation_status = 'corrupted' then 1 else null end)     AS corrupted,
                 count(case when confirmation_status = 'confirmed' then 1 else null end)     AS confirmed,
                 count(case when confirmation_status = 'not_processed' then 1 else null end) AS not_processed,
                 count(case when confirmation_status = 'forked' then 1 else null end)        AS forked
          FROM interactions
          WHERE contract_id = ?;
      `, contractId
    );

    const total = result?.rows?.length > 0 ? result?.rows[0].total : 0;

    ctx.body = {
      paging: {
        total,
        limit: parsedLimit,
        items: result?.rows.length,
        page: parsedPage,
        pages: Math.ceil(total / parsedLimit)
      },
      ...(totalInteractions && {
        total: {
          confirmed: totalInteractions?.rows[0].confirmed,
          corrupted: totalInteractions?.rows[0].corrupted,
          not_processed: totalInteractions?.rows[0].not_processed,
          forked: totalInteractions?.rows[0].forked
        }
      }),
      interactions: result?.rows?.map((r: any) => ({
        status: r.confirmation_status,
        confirming_peers: r.confirming_peer,
        confirmations: r.confirmations,
        interaction: r.interaction
      }))
    };

    logger.debug("Interactions loaded in", benchmark.elapsed());

  } catch (e: any) {
    ctx.logger.error(e);
    ctx.status = 500;
    ctx.body = {message: e};
  }
}
