import { Router, Request, Response } from 'express';
import { prismaRead as prisma } from '../db';
import { z } from 'zod';

export const complianceRouter = Router();

const sanctionedAddressSchema = z.object({
  address: z.string().min(1),
  name: z.string().optional(),
  jurisdiction: z.string().optional(),
  listSource: z.enum(['OFAC', 'EU', 'UN', 'custom']),
});

// POST /compliance/sanctioned — add sanctioned address
complianceRouter.post('/sanctioned', async (req: Request, res: Response) => {
  try {
    const data = sanctionedAddressSchema.parse(req.body);
    const sanctioned = await prisma.sanctionedAddress.create({ data });
    res.status(201).json(sanctioned);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /compliance/sanctioned — list sanctioned addresses
complianceRouter.get('/sanctioned', async (req: Request, res: Response) => {
  try {
    const sanctioned = await prisma.sanctionedAddress.findMany({
      orderBy: { addedAt: 'desc' },
      take: 100,
    });
    res.json({ data: sanctioned });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /compliance/flags — list compliance flags
complianceRouter.get('/flags', async (req: Request, res: Response) => {
  try {
    const reviewed = req.query.reviewed === 'true' ? true : req.query.reviewed === 'false' ? false : undefined;
    const flags = await prisma.complianceFlag.findMany({
      where: reviewed !== undefined ? { reviewed } : {},
      include: { sanctionedAddress: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ data: flags });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /compliance/check/:address — check if address is sanctioned
complianceRouter.get('/check/:address', async (req: Request, res: Response) => {
  try {
    const sanctioned = await prisma.sanctionedAddress.findUnique({
      where: { address: req.params.address },
    });
    const flags = await prisma.complianceFlag.findMany({
      where: {
        OR: [
          { sourceAccount: req.params.address },
          { destinationAccount: req.params.address },
        ],
      },
      include: { sanctionedAddress: true },
    });
    res.json({ isSanctioned: !!sanctioned, flags });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// PATCH /compliance/flags/:id — mark flag as reviewed
complianceRouter.patch('/flags/:id', async (req: Request, res: Response) => {
  try {
    const { reviewed, reviewedBy, notes } = req.body;
    const flag = await prisma.complianceFlag.update({
      where: { id: req.params.id },
      data: {
        reviewed: reviewed ?? true,
        reviewedBy,
        reviewedAt: reviewed ? new Date() : null,
        notes,
      },
    });
    res.json(flag);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
