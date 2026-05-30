import { Router, Request, Response } from 'express';
import { prismaRead as prisma } from '../db';
import { registerFrozenKey, thawFrozenKey } from '../indexer/freeze-scanner';
import { z } from 'zod';

export const freezeRouter = Router();

// GET /freeze/keys — list active frozen ledger keys
freezeRouter.get('/keys', async (_req: Request, res: Response) => {
  try {
    const keys = await prisma.frozenLedgerKey.findMany({
      where: { active: true },
      orderBy: { frozenAtLedger: 'desc' },
    });
    res.json({ data: keys, total: keys.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// GET /freeze/violations — list transactions that touched a frozen key
const violationsSchema = z.object({
  contract: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  page: z.coerce.number().min(1).default(1),
});

freezeRouter.get('/violations', async (req: Request, res: Response) => {
  try {
    const q = violationsSchema.parse(req.query);
    const where = q.contract ? { contractAddress: q.contract } : {};
    const skip = (q.page - 1) * q.limit;
    const [data, total] = await Promise.all([
      prisma.freezeViolation.findMany({
        where,
        orderBy: { ledgerSequence: 'desc' },
        skip,
        take: q.limit,
      }),
      prisma.freezeViolation.count({ where }),
    ]);
    res.json({ data, total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// POST /freeze/keys — register a new frozen key (admin / validator relay)
const registerSchema = z.object({
  ledgerKey: z.string().min(1),
  frozenAtLedger: z.number().int().positive(),
  frozenAtTime: z.string().datetime(),
  reason: z.string().optional(),
});

freezeRouter.post('/keys', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);
    await registerFrozenKey(
      body.ledgerKey,
      body.frozenAtLedger,
      new Date(body.frozenAtTime),
      body.reason,
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// DELETE /freeze/keys/:ledgerKey — thaw a frozen key
freezeRouter.delete('/keys/:ledgerKey', async (req: Request, res: Response) => {
  try {
    await thawFrozenKey(decodeURIComponent(req.params.ledgerKey));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
