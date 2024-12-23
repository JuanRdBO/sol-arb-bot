import {
	type AddressLookupTableAccount,
	TransactionMessage,
	type Connection,
	type Signer,
	type TransactionInstruction,
	VersionedTransaction,
	ComputeBudgetProgram,
} from "@solana/web3.js";
import { Helius } from "helius-sdk";
import bs58 from "bs58";
import axios from "axios";

export async function sendIxTx(
	instructions: TransactionInstruction[],
	addressLookupTableAccounts: AddressLookupTableAccount[],
	signers: Signer[],
	method: "jito" | "helius",
	connection: Connection,
) {
	if (method === "jito") {
		// v0 tx
		const { blockhash } = await connection.getLatestBlockhash();
		const messageV0 = new TransactionMessage({
			payerKey: signers[0].publicKey,
			recentBlockhash: blockhash,
			instructions: instructions,
		}).compileToV0Message(addressLookupTableAccounts);
		const transaction = new VersionedTransaction(messageV0);
		transaction.sign([signers[0]]);

		// simulate
		// const simulationResult = await connection.simulateTransaction(transaction);
		// console.log(JSON.stringify(simulationResult, null, 2));

		// send bundle
		const serializedTransaction = transaction.serialize();
		const base58Transaction = bs58.encode(serializedTransaction);

		const bundle = {
			jsonrpc: "2.0",
			id: 1,
			method: "sendBundle",
			params: [[base58Transaction]],
		};

		const bundle_resp = await axios.post(
			"https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
			bundle,
			{
				headers: {
					"Content-Type": "application/json",
				},
			},
		);
		const bundle_id = bundle_resp.data.result;
		console.log(`sent to frankfurt, bundle id: ${bundle_id}`);
		return bundle_id;
	}

	// If Helius
	const heliusApiKey = process.env.HELIUS_API_KEY;
	if (!heliusApiKey) {
		throw new Error("HELIUS_API_KEY is not set");
	}
	const helius = new Helius(heliusApiKey);

	const filteredInstructions = instructions.filter(
		(ix) =>
			ix.programId.toBase58() !== ComputeBudgetProgram.programId.toBase58(),
	);

	const transactionSignature = await helius.rpc.sendSmartTransaction(
		filteredInstructions,
		signers,
		addressLookupTableAccounts,
	);
	console.log(`Successful transfer: ${transactionSignature}`);
	return transactionSignature;
}
