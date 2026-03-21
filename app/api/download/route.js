import { downloadController } from "@/controllers/download.controller";
import { wraper } from "@/utils/wraper";

export const POST = wraper(downloadController);
