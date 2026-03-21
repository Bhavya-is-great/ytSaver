import { proxyController } from "@/controllers/proxy.controller";
import { wraper } from "@/utils/wraper";

export const GET = wraper(proxyController);
export const maxDuration = 300;
