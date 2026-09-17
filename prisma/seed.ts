import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('MudeEstaSenha123', 12);

  const companies = await Promise.all(
    [
      { name: 'Espaço Natália Rodovalho - Unidade Centro', slug: 'espaco-nr-centro' },
      { name: 'Espaço Natália Rodovalho - Unidade Barreiro', slug: 'espaco-nr-barreiro' },
    ].map((company) =>
      prisma.company.upsert({
        where: { slug: company.slug },
        update: {},
        create: {
          ...company,
          settings: {
            create: {
              salonName: company.name,
              ownerName: 'Natália Rodovalho',
              email: 'contato@espaconr.com.br',
              greetingMessage: 'Olá, {nome}! Seja bem-vinda ao Espaço NR. Como podemos ajudar?',
            },
          },
        },
      }),
    ),
  );

  const owner = await prisma.user.upsert({
    where: { email: 'contato@espaconr.com.br' },
    update: {},
    create: {
      name: 'Natália Rodovalho',
      email: 'contato@espaconr.com.br',
      passwordHash,
    },
  });

  for (const company of companies) {
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: owner.id, companyId: company.id } },
      update: {},
      create: { userId: owner.id, companyId: company.id, role: Role.ADMIN },
    });
  }

  console.log('Seed concluído.');
  console.log('Login de demonstração: contato@espaconr.com.br / MudeEstaSenha123');
  console.log('Empresas criadas:', companies.map((c) => c.name).join(' | '));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
