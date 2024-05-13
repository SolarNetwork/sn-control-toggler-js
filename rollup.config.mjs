import typescript from "@rollup/plugin-typescript";

export default {
	external: (id) => {
		return /(solarnetwork-api-core)/.test(id);
	},
	input: "src/main/index.ts",
	output: {
		globals: {
		},
	},
	plugins: [typescript({ tsconfig: "tsconfig.dist.json" })],
};
