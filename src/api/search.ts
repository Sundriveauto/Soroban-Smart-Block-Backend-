/**
 * GET /api/v1/search?q=<query>
 *
 * Universal search endpoint for the Soroban block explorer.
 * Detects the input type from the query string and returns the matching resource.
 *
 * Detection rules (in priority order):
 *   1. 64-char hex string            → transaction hash lookup
 *   2. Starts with 'C', 56 chars     → contract address lookup
 *   3. Starts with 'G', 56 chars     → account lookup (recent transactions)
 *   4. Anything else                 → { type: 'unknown' }
 *
 * Response shape:
 *   { type: 'transaction' | 'contract' | 'account' | 'unknown', data: <resource | null> }
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prismaRead as prisma } from '../db';

export const searchRouter = Router();

// ── Detection helpers ─────────────────────────────────────────────────────────

const HEX64_RE = /^[0-9a-fA-F]{64}$/;

type InputType = 'transaction' | 'contract' | 'account' | 'unknown';

function detectInputType(q: string): InputType {
  const trimmed = q.trim();
  if (HEX64_RE.test(trimmed))                          return 'transaction';
  if (trimmed.startsWith('C') && trimmed.length === 56) return 'contract';
  if (trimmed.startsWith('G') && trimmed.length === 56) return 'account';
  return 'unknown';
}

// ── Resource fetchers ─────────────────────────────────────────────────────────

async function fetchTransaction(hash: string) {
  return prisma.transaction.findUnique({
    where: { hash },
    select: {
      hash: true,
      ledgerSequence: true,
      ledgerCloseTime: true,
      sourceAccount: true,
      contractAddress: true,
      functionName: true,
      status: true,
      humanReadable: true,
      feeCharged: true,
      sorobanResources: true,
      failureReason: true,
    },
  });
}

async function fetchContract(address: string) {
  return prisma.contract.findUnique({
    where: { address },
    select: {
      address: true,
      name: true,
      description: true,
      isToken: true,
      tokenSymbol: true,
      tokenName: true,
      tokenDecimals: true,
      isVerified: true,
      wasmHash: true,
      createdAt: true,
    },
  });
}

async function fetchAccount(address: string) {
  // Return the 20 most recent transactions for this account
  const transactions = await prisma.transaction.findMany({
    where: { sourceAccount: address },
    orderBy: { ledgerSequence: 'desc' },
    take: 20,
    select: {
      hash: true,
      ledgerSequence: true,
      ledgerCloseTime: true,
      contractAddress: true,
      functionName: true,
      status: true,
      humanReadable: true,
      feeCharged: true,
    },
  });

  const total = await prisma.transaction.count({
    where: { sourceAccount: address },
  });

  return { address, transactions, total };
}

// ── Route ─────────────────────────────────────────────────────────────────────

const querySchema = z.object({
  q: z.string().min(1).max(256).transform((v) => v.trim()),
});

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Universal search — transaction hash, contract address, or account address
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: >
 *           The search query. Accepted formats:
 *           64-char hex string (transaction hash),
 *           56-char string starting with C (contract address),
 *           56-char string starting with G (account address).
 *     responses:
 *       200:
 *         description: Search result with detected type and matching resource data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [type, data]
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [transaction, contract, account, unknown]
 *                 data:
 *                   nullable: true
 *                   description: The matched resource, or null if not found
 *       400:
 *         description: Missing or invalid query parameter
 */
searchRouter.get('/', async (req: Request, res: Response) => {
  // Parse and validate
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Missing or invalid query parameter "q"',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { q } = parsed.data;
  const type = detectInputType(q);

  try {
    switch (type) {
      case 'transaction': {
        const data = await fetchTransaction(q);
        return res.json({ type: 'transaction', data: data ?? null });
      }

      case 'contract': {
        const data = await fetchContract(q);
        return res.json({ type: 'contract', data: data ?? null });
      }

      case 'account': {
        const data = await fetchAccount(q);
        // Return null data if the account has no transactions at all
        return res.json({
          type: 'account',
          data: data.total > 0 ? data : null,
        });
      }

      case 'unknown':
      default:
        return res.json({ type: 'unknown', data: null });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Search failed', detail: String(e) });
  }
});
