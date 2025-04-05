import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
	external: (id) => {
		return /solarnetwork-api-core/.test(id);
	},
	input: "src/main/index.ts",
	output: {
		format: "cjs",
		globals: {},
	},
	plugins: [
		typescript({ tsconfig: "tsconfig.dist.json" }),
		nodeResolve(),
		commonjs(),
	],
};
