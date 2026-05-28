import { Router, Request, Response } from 'express';
import { prismaRead as prisma } from '../db';
import { z } from 'zod';

export const taxRouter = Router();

// GET /tax/lots/:address — retrieve cost-basis tax lots
taxRouter.get('/lots/:address', async (req: Request, res: Response) => {
  try {
    const { taxYear } = req.query;
    const where: any = { walletAddress: req.params.address };
    
    if (taxYear) {
      const year = parseInt(String(taxYear), 10);
      where.acquisitionDate = {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`),
      };
    }

    const lots = await prisma.taxLot.findMany({
      where,
      orderBy: { acquisitionDate: 'asc' },
    });

    // Calculate totals
    const totalCostBasis = lots.reduce((sum, lot) => {
      return sum + parseFloat(lot.totalCostBasis || '0');
    }, 0);

    const totalGain = lots.reduce((sum, lot) => {
      if (lot.gainLoss) return sum + parseFloat(lot.gainLoss);
      return sum;
    }, 0);

    res.json({
      data: lots,
      summary: {
        totalLots: lots.length,
        totalCostBasis: totalCostBasis.toString(),
        totalGain: totalGain.toString(),
      },
    });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// POST /tax/export — generate Form 8949 CSV export
taxRouter.post('/export', async (req: Request, res: Response) => {
  try {
    const { walletAddress, taxYear } = z.object({
      walletAddress: z.string().min(1),
      taxYear: z.number().int().min(2000).max(2100),
    }).parse(req.body);

    const job = await prisma.taxExportJob.create({
      data: {
        walletAddress,
        taxYear,
        status: 'pending',
      },
    });

    // Async processing would happen here in production
    res.status(201).json(job);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /tax/export/:jobId — check export job status
taxRouter.get('/export/:jobId', async (req: Request, res: Response) => {
  try {
    const job = await prisma.taxExportJob.findUnique({
      where: { id: req.params.jobId },
    });

    if (!job) {
      return res.status(404).json({ error: 'Export job not found' });
    }

    res.json(job);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /tax/summary/:address — get tax summary for wallet
taxRouter.get('/summary/:address', async (req: Request, res: Response) => {
  try {
    const { taxYear } = req.query;
    const year = taxYear ? parseInt(String(taxYear), 10) : new Date().getFullYear();

    const lots = await prisma.taxLot.findMany({
      where: {
        walletAddress: req.params.address,
        acquisitionDate: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
      },
    });

    const disposedLots = lots.filter(l => l.disposalDate);
    const totalGain = disposedLots.reduce((sum, lot) => {
      return sum + parseFloat(lot.gainLoss || '0');
    }, 0);

    const totalLoss = disposedLots.filter(l => parseFloat(l.gainLoss || '0') < 0)
      .reduce((sum, lot) => sum + parseFloat(lot.gainLoss || '0'), 0);

    res.json({
      taxYear: year,
      totalLots: lots.length,
      disposedLots: disposedLots.length,
      totalGain: Math.max(0, totalGain).toString(),
      totalLoss: Math.abs(Math.min(0, totalLoss)).toString(),
      netGainLoss: totalGain.toString(),
    });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
