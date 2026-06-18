import { default as handler } from "./.open-next/worker.js";

type Env = {
  ASSETS: { fetch(req: Request): Promise<Response> };
  R2_BUCKET: R2Bucket;
};

const worker = {
  fetch: (handler as { fetch: typeof fetch }).fetch,
};

export default worker;
