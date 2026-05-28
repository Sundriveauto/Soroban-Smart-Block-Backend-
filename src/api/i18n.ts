import { Router, Request, Response } from 'express';
import { prismaRead as prisma } from '../db';
import { z } from 'zod';

export const i18nRouter = Router();

// Simple template interpolation: replace {key} with values
function interpolate(template: string, values: Record<string, any>): string {
  return template.replace(/{(\w+)}/g, (_, key) => {
    const val = values[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

// POST /i18n/keys — register translation key
i18nRouter.post('/keys', async (req: Request, res: Response) => {
  try {
    const { key, defaultText, context } = z.object({
      key: z.string().min(1),
      defaultText: z.string().min(1),
      context: z.string().optional(),
    }).parse(req.body);

    const translationKey = await prisma.translationKey.create({
      data: { key, defaultText, context },
    });

    res.status(201).json(translationKey);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// POST /i18n/translations — add translation for a key
i18nRouter.post('/translations', async (req: Request, res: Response) => {
  try {
    const { keyId, language, translatedText, approvedBy } = z.object({
      keyId: z.string().min(1),
      language: z.string().min(2).max(5),
      translatedText: z.string().min(1),
      approvedBy: z.string().optional(),
    }).parse(req.body);

    const translation = await prisma.translation.create({
      data: {
        keyId,
        language,
        translatedText,
        approvedBy,
        approvedAt: approvedBy ? new Date() : null,
      },
    });

    res.status(201).json(translation);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /i18n/translate — translate text with interpolation
i18nRouter.get('/translate', async (req: Request, res: Response) => {
  try {
    const { key, language, values } = z.object({
      key: z.string().min(1),
      language: z.string().min(2).max(5).default('en'),
      values: z.record(z.any()).optional(),
    }).parse(req.query);

    const translationKey = await prisma.translationKey.findUnique({
      where: { key },
      include: {
        translations: {
          where: { language },
        },
      },
    });

    if (!translationKey) {
      return res.status(404).json({ error: 'Translation key not found' });
    }

    const translation = translationKey.translations[0];
    const template = translation?.translatedText || translationKey.defaultText;
    const parsed = typeof values === 'string' ? JSON.parse(values) : values || {};
    const result = interpolate(template, parsed);

    res.json({ key, language, result });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /i18n/keys — list all translation keys
i18nRouter.get('/keys', async (req: Request, res: Response) => {
  try {
    const keys = await prisma.translationKey.findMany({
      include: {
        translations: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ data: keys });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /i18n/languages — list supported languages
i18nRouter.get('/languages', async (req: Request, res: Response) => {
  try {
    const languages = await prisma.translation.findMany({
      distinct: ['language'],
      select: { language: true },
    });

    res.json({
      languages: languages.map(l => l.language),
      supported: ['en', 'es', 'ko', 'fr', 'de', 'ja', 'zh'],
    });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// PATCH /i18n/translations/:id — approve translation
i18nRouter.patch('/translations/:id', async (req: Request, res: Response) => {
  try {
    const { approvedBy } = req.body;
    const translation = await prisma.translation.update({
      where: { id: req.params.id },
      data: {
        approvedBy,
        approvedAt: new Date(),
      },
    });

    res.json(translation);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
