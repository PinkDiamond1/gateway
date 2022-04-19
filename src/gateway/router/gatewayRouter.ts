import Router from "@koa/router";
import {contractsRoute} from "./routes/contractsRoute";
import {interactionsRoute} from "./routes/interactionsRoute";
import {searchRoute} from "./routes/searchRoute";
import {statsRoute} from "./routes/statsRoute";
import {statsTxPerDayRoute} from "./routes/statsTxPerDayRoute";
import {contractRoute} from "./routes/contractRoute";
import {interactionRoute} from "./routes/interactionRoute";
import {safeContractsRoute} from "./routes/safeContractsRoute";
import {sequencerRoute} from "./routes/sequencerRoute";
import {interactionsStreamRoute} from "./routes/interactionsStreamRoute";
import {deployContractRoute} from "./routes/deployContractRoute";

const gatewayRouter = new Router({prefix: '/gateway'});

gatewayRouter.get("/contracts", contractsRoute);
gatewayRouter.get("/contracts/:id", contractRoute);
gatewayRouter.post("/contracts/deploy", deployContractRoute);
gatewayRouter.get("/contracts-safe", safeContractsRoute);
gatewayRouter.get("/search/:phrase", searchRoute);
// separate "transactionId" route to make caching in cloudfront possible
gatewayRouter.get("/interactions/transactionId", interactionsRoute);
gatewayRouter.get("/interactions", interactionsRoute);
gatewayRouter.get("/interactions-stream", interactionsStreamRoute);
gatewayRouter.get("/interactions/:id", interactionRoute);
gatewayRouter.get("/stats", statsRoute);
gatewayRouter.get("/stats/per-day", statsTxPerDayRoute);
gatewayRouter.post("/sequencer/register", sequencerRoute);

export default gatewayRouter;
