// Dev-only seed: wipes and repopulates the database so `pnpm db:seed` is
// idempotent to re-run while iterating locally.
import { PrismaClient, MessageType } from "@prisma/client";
import { ulid } from "ulid";

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;
const SEED_USERS = [
  { name: "Aisha", email: "aisha@example.com", avatarUrl: "https://api.dicebear.com/9.x/notionists/svg?seed=Aisha" },
  { name: "Rohan", email: "rohan@example.com", avatarUrl: "https://api.dicebear.com/9.x/notionists/svg?seed=Rohan" },
  { name: "Zara", email: "zara@example.com", avatarUrl: "https://api.dicebear.com/9.x/notionists/svg?seed=Zara" },
  { name: "Imran", email: "imran@example.com", avatarUrl: "https://api.dicebear.com/9.x/notionists/svg?seed=Imran" },
];

const TEXT_SAMPLES = [
  "hey, you around?",
  "just got out of a meeting",
  "lol true",
  "sending you the doc in a sec",
  "can we push this to tomorrow?",
  "yeah that works for me",
  "did you see the game last night",
  "omw",
  "on it",
  "thanks!",
  "no worries at all",
  "let me check and get back to you",
  "sounds good 👍",
  "haha yeah exactly",
  "one sec, grabbing coffee",
  "that's hilarious",
  "wait what happened",
  "call me when you're free",
  "perfect, see you then",
  "still up for tonight?",
];

// Random back-and-forth timestamp series: bursts of messages within active
// hours (8am-11pm local), alternating senders in short runs like a real chat.
function generateTimestamps(count: number, spanDays: number, endingAt: Date): Date[] {
  const timestamps: Date[] = [];
  const start = endingAt.getTime() - spanDays * DAY_MS;
  // Distribute messages across days with a skew toward more recent days.
  const perDayWeights: number[] = [];
  for (let d = 0; d < spanDays; d++) {
    perDayWeights.push(0.3 + Math.random() * (1 + d / spanDays));
  }
  const weightSum = perDayWeights.reduce((a, b) => a + b, 0);

  let remaining = count;
  for (let d = 0; d < spanDays && remaining > 0; d++) {
    const isLastDay = d === spanDays - 1;
    const dayCount = isLastDay ? remaining : Math.min(remaining, Math.round((perDayWeights[d]! / weightSum) * count));
    const dayStart = start + d * DAY_MS;

    // Bursts of messages clustered in time, repeated until the day's full
    // quota is placed (a fixed burst count could under-fill and silently
    // drop messages short of the requested total).
    let placed = 0;
    while (placed < dayCount) {
      const activeHourStart = 8 + Math.random() * 13; // 8am-9pm start
      const burstStartMs = dayStart + activeHourStart * 60 * 60 * 1000;
      const burstSize = Math.min(dayCount - placed, 1 + Math.floor(Math.random() * 10));
      for (let i = 0; i < burstSize; i++) {
        const jitter = i * (5000 + Math.random() * 60000); // 5-65s apart within a burst
        timestamps.push(new Date(burstStartMs + jitter));
        placed++;
      }
    }
    remaining -= dayCount;
  }

  timestamps.sort((a, b) => a.getTime() - b.getTime());
  return timestamps.slice(0, count);
}

async function seedConversation(params: {
  memberIds: [string, string];
  messageCount: number;
  spanDays: number;
}) {
  const { memberIds, messageCount, spanDays } = params;

  const conversation = await prisma.conversation.create({
    data: {
      members: {
        create: memberIds.map((userId) => ({ userId })),
      },
    },
  });

  const timestamps = generateTimestamps(messageCount, spanDays, new Date());

  const rows = timestamps.map((createdAt, i) => ({
    id: undefined,
    conversationId: conversation.id,
    senderId: memberIds[i % 2]!,
    clientMsgId: ulid(),
    type: MessageType.TEXT,
    body: TEXT_SAMPLES[i % TEXT_SAMPLES.length],
    createdAt,
  }));

  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.message.createMany({ data: rows.slice(i, i + CHUNK) });
  }

  const lastMessageAt = timestamps.at(-1) ?? conversation.createdAt;
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt },
  });

  return conversation;
}

async function main() {
  console.log("Clearing existing data...");
  await prisma.message.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany();

  console.log("Creating users...");
  const users = await Promise.all(
    SEED_USERS.map((u) => prisma.user.create({ data: u })),
  );
  const [aisha, rohan, zara, imran] = users;
  if (!aisha || !rohan || !zara || !imran) throw new Error("seed user creation failed");

  console.log("Seeding main conversation (12,000 messages, ~60 days)...");
  await seedConversation({ memberIds: [aisha.id, rohan.id], messageCount: 12_000, spanDays: 60 });

  console.log("Seeding side conversations...");
  await seedConversation({ memberIds: [aisha.id, zara.id], messageCount: 18, spanDays: 10 });
  await seedConversation({ memberIds: [rohan.id, imran.id], messageCount: 9, spanDays: 5 });

  const total = await prisma.message.count();
  console.log(`Done. Total messages: ${total}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
