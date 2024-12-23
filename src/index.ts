import "dotenv/config";
import { getKeypairFromEnvironment } from "@solana-developers/helpers";
import axios from "axios";
import {
	Connection,
	PublicKey,
	SystemProgram,
	ComputeBudgetProgram,
	type TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "node:buffer";
import { sendIxTx } from "./sendIxTx";

// wallet
const heliusApiKey = process.env.HELIUS_API_KEY;
const payer = getKeypairFromEnvironment("SECRET_KEY");
console.log("payer:", payer.publicKey.toBase58());

const connection = new Connection(
	`https://staked.helius-rpc.com?api-key=${heliusApiKey}`,
	"processed",
);
const quoteUrl = "http://127.0.0.1:8080/quote";
const swapInstructionUrl = "http://127.0.0.1:8080/swap-instructions";

// WSOL and USDC mint address
const wSolMint = "So11111111111111111111111111111111111111112";
const usdcMint = "5DQSDg6SGkbsbykq4mQstpcL4d5raEHc6rY7LgBwpump"; //"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function instructionFormat(instruction) {
	return {
		programId: new PublicKey(instruction.programId),
		keys: instruction.accounts.map((account) => ({
			pubkey: new PublicKey(account.pubkey),
			isSigner: account.isSigner,
			isWritable: account.isWritable,
		})),
		data: Buffer.from(instruction.data, "base64"),
	};
}

async function run() {
	const start = Date.now();

	// quote0: WSOL -> USDC
	const quote0Params = {
		inputMint: wSolMint,
		outputMint: usdcMint,
		amount: 10_000_000, // 0.01 WSOL
		onlyDirectRoutes: false,
		slippageBps: 0,
		maxAccounts: 32,
	};
	const quote0Resp = await axios.get(quoteUrl, { params: quote0Params });

	// quote1: USDC -> WSOL
	const quote1Params = {
		inputMint: usdcMint,
		outputMint: wSolMint,
		amount: quote0Resp.data.outAmount,
		onlyDirectRoutes: false,
		slippageBps: 0,
		maxAccounts: 32,
	};
	const quote1Resp = await axios.get(quoteUrl, { params: quote1Params });

	// profit but not real
	const diffLamports = quote1Resp.data.outAmount - quote0Params.amount;
	console.log("diffLamports:", diffLamports);
	const jitoTip = Math.floor(diffLamports * 0.5);

	// threhold
	const thre = 3000;
	if (diffLamports > thre) {
		// merge quote0 and quote1 response
		const mergedQuoteResp = quote0Resp.data;
		mergedQuoteResp.outputMint = quote1Resp.data.outputMint;
		mergedQuoteResp.outAmount = String(quote0Params.amount + jitoTip);
		mergedQuoteResp.otherAmountThreshold = String(
			quote0Params.amount + jitoTip,
		);
		mergedQuoteResp.priceImpactPct = "0";
		mergedQuoteResp.routePlan = mergedQuoteResp.routePlan.concat(
			quote1Resp.data.routePlan,
		);

		// console.log("Merged quote resp", JSON.stringify(mergedQuoteResp, null, 2));

		// swap
		const swapData = {
			userPublicKey: payer.publicKey.toBase58(),
			wrapAndUnwrapSol: true,
			useSharedAccounts: false,
			computeUnitPriceMicroLamports: 1,
			dynamicComputeUnitLimit: true,
			skipUserAccountsRpcCalls: true,
			quoteResponse: mergedQuoteResp,
		};
		const instructionsResp = await axios.post(swapInstructionUrl, swapData);
		const instructions = instructionsResp.data;

		// bulid tx
		let ixs: TransactionInstruction[] = [];

		// 1. cu
		const computeUnitLimitInstruction =
			ComputeBudgetProgram.setComputeUnitLimit({
				units: instructions.computeUnitLimit,
			});
		ixs.push(computeUnitLimitInstruction);

		// 2. setup
		const setupInstructions =
			instructions.setupInstructions.map(instructionFormat);
		ixs = ixs.concat(setupInstructions);

		// 3. save balance instruction from your program

		// 4. swap
		const swapInstructions = instructionFormat(instructions.swapInstruction);
		ixs.push(swapInstructions);

		// 5. cal real profit and pay for jito from your program
		// a simple transfer instruction here
		// the real profit and tip should be calculated in your program
		const tipInstruction = SystemProgram.transfer({
			fromPubkey: payer.publicKey,
			toPubkey: new PublicKey("Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY"), // a random account from jito tip accounts
			lamports: jitoTip,
		});
		ixs.push(tipInstruction);

		// ALT
		const addressLookupTableAccounts = await Promise.all(
			instructions.addressLookupTableAddresses.map(async (address) => {
				const result = await connection.getAddressLookupTable(
					new PublicKey(address),
				);
				return result.value;
			}),
		);

		await sendIxTx(
			ixs,
			addressLookupTableAccounts,
			[payer],
			"jito",
			connection,
		);

		// cal time cost
		const end = Date.now();
		const duration = end - start;

		console.log(`${wSolMint} - ${usdcMint}`);
		console.log(
			`slot: ${mergedQuoteResp.contextSlot}, total duration: ${duration}ms`,
		);
	}
}

async function main() {
	while (true) {
		await run();

		// wait 200ms
		await wait(200);
	}
}

main();
