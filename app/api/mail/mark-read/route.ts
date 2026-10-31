import { mutateMessage } from "../mutate";
export const POST = (request: Request) => mutateMessage(request, "mark-read");
