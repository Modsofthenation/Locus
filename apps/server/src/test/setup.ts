import { gitTestEnv } from "./gitEnv.js";

Object.assign(process.env, gitTestEnv());
