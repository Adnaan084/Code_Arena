/**
 * Seed: provisions a throwaway demo game with the full sample question bank
 * and two teams so the UI can be explored immediately in development.
 * (In production the host creates a game from the dashboard; seeding a game
 *  here is a dev convenience only.
 * )
 */
import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { defaultConfigFromEnv } from '@wcc/shared';
import { questionUpsertSchema } from '@wcc/shared';
import bank from './questions.bank.json';

const prisma = new PrismaClient();

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const makeCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[randomBytes(1)[0]! % chars.length];
  return s;
};

async function main(): Promise<void> {
  const config = defaultConfigFromEnv();

  // Validate the bank against the same schema the host import uses.
  const parsed = questionUpsertSchema.array().safeParse(bank);
  if (!parsed.success) {
    console.error('✗ Question bank failed validation:', JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
  }
  const questions = parsed.data;

  const code = makeCode();
  const hostToken = randomBytes(32).toString('hex');
  const game = await prisma.game.create({
    data: {
      code,
      title: 'Sample Event (dev)',
      state: 'LOBBY',
      config,
      hostTokenHash: sha256(hostToken),
    },
  });

  const teamA = await prisma.team.create({
    data: {
      gameId: game.id,
      name: 'Bug Slayers',
      accessTokenHash: sha256(randomBytes(24).toString('hex')),
      coins: config.startingCoins,
      joinOrder: 1,
      members: {
        create: [
          { seat: 1, playerName: 'Ada' },
          { seat: 2, playerName: 'Grace' },
        ],
      },
    },
  });
  const teamB = await prisma.team.create({
    data: {
      gameId: game.id,
      name: 'Code Blooded',
      accessTokenHash: sha256(randomBytes(24).toString('hex')),
      coins: config.startingCoins,
      joinOrder: 2,
      members: {
        create: [
          { seat: 1, playerName: 'Linus' },
          { seat: 2, playerName: 'Ken' },
        ],
      },
    },
  });

  for (const q of questions) {
    await prisma.question.create({
      data: {
        gameId: game.id,
        code: q.code,
        type: q.type,
        difficulty: q.difficulty,
        category: q.category,
        title: q.title,
        body: q.body,
        codeSnippet: q.codeSnippet ?? null,
        answerData: q.answerData as object,
        price: q.price ?? config.priceTable[q.difficulty],
        reward: q.reward ?? config.rewardTable[q.difficulty],
        hint: q.hint ?? null,
        explanation: q.explanation ?? null,
        enabled: true,
        maxTrades: config.maxTradesPerQuestion,
      },
    });
  }

  await prisma.transaction.create({
    data: {
      gameId: game.id,
      teamId: teamA.id,
      type: 'INITIAL',
      amount: config.startingCoins,
      balanceAfter: config.startingCoins,
      reason: 'Initial balance',
    },
  });
  await prisma.transaction.create({
    data: {
      gameId: game.id,
      teamId: teamB.id,
      type: 'INITIAL',
      amount: config.startingCoins,
      balanceAfter: config.startingCoins,
      reason: 'Initial balance',
    },
  });

  console.log('\n────────── DEMO GAME SEEDED ──────────');
  console.log(`Game code : ${code}`);
  console.log(`Host token: ${hostToken}  (use on the host login screen)`);
  console.log(`Teams     : ${teamA.name}, ${teamB.name} (tokens only exist in the DB)`);
  console.log(`Questions : ${questions.length} loaded from the question bank`);
  console.log('──────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());