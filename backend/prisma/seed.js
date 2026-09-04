// Development/test seed data only.
// Run with: npm run seed
const bcrypt = require("bcrypt");
const prisma = require("./client");
const { generateInviteCode } = require("../services/turnService");

async function main() {
  const password = await bcrypt.hash("password123", 10);

  const names = ["Rohan", "Aman", "Sagar", "Bibek"];
  const users = [];

  for (const name of names) {
    const email = `${name.toLowerCase()}@example.com`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { name, email, passwordHash: password },
    });
    users.push(user);
  }

  const existingGroup = await prisma.group.findFirst({
    where: { name: "Sunrise Apartment" },
  });

  if (existingGroup) {
    console.log("Seed data already exists. Skipping group creation.");
    console.log(`Invite code: ${existingGroup.inviteCode}`);
    return;
  }

  const inviteCode = await generateInviteCode();

  const group = await prisma.group.create({
    data: {
      name: "Sunrise Apartment",
      inviteCode,
      createdBy: users[0].id,
    },
  });

  for (let i = 0; i < users.length; i++) {
    await prisma.groupMember.create({
      data: {
        groupId: group.id,
        userId: users[i].id,
        turnOrder: i + 1,
        isCurrentTurn: i === 0,
      },
    });
  }

  console.log("Seed complete.");
  console.log(`Group: ${group.name}`);
  console.log(`Invite code: ${group.inviteCode}`);
  console.log("Users (email / password): ");
  names.forEach((n) =>
    console.log(`  ${n.toLowerCase()}@example.com / password123`)
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
