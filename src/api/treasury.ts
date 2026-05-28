import { Router, Request, Response } from 'express';
import { prismaRead as prisma } from '../db';
import { z } from 'zod';

export const treasuryRouter = Router();

const treasurySchema = z.object({
  address: z.string().min(1),
  name: z.string().min(1),
  requiredThreshold: z.number().int().positive(),
  totalSigners: z.number().int().positive(),
  adminEmail: z.string().email().optional(),
});

// POST /treasury — register a treasury wallet
treasuryRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = treasurySchema.parse(req.body);
    const treasury = await prisma.treasuryWallet.create({
      data,
    });
    res.status(201).json(treasury);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /treasury/:address — get treasury audit history
treasuryRouter.get('/:address', async (req: Request, res: Response) => {
  try {
    const treasury = await prisma.treasuryWallet.findUnique({
      where: { address: req.params.address },
      include: {
        auditSnapshots: {
          orderBy: { ledgerSequence: 'desc' },
          take: 50,
        },
      },
    });

    if (!treasury) {
      return res.status(404).json({ error: 'Treasury not found' });
    }

    res.json(treasury);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /treasury/:address/alerts — get unresolved alerts
treasuryRouter.get('/:address/alerts', async (req: Request, res: Response) => {
  try {
    const snapshots = await prisma.treasuryAuditSnapshot.findMany({
      where: {
        treasury: { address: req.params.address },
        alertSent: true,
      },
      orderBy: { ledgerSequence: 'desc' },
      take: 20,
    });

    res.json({ alerts: snapshots });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
