import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const products = [
    {
        id: 'golden-retriever-pup',
        name: 'Golden Retriever Puppy',
        description: 'Healthy, vaccinated 12-week-old Golden Retriever. Very friendly and great with kids.',
        image: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=800&q=80',
        vendor: 'Green Valley Kennels',
        price: 250000,
        category: 'dogs',
        rating: 5.0,
    },
    {
        id: 'premium-cat-kibble',
        name: 'Premium Salmon Cat Food',
        description: 'Rich in Omega-3. Supports a shiny coat and healthy digestion for indoor cats.',
        image: 'https://images.unsplash.com/photo-1589924691106-386769065963?auto=format&fit=crop&w=800&q=80',
        vendor: 'PetCare Central',
        price: 15000,
        category: 'food',
        rating: 4.8,
    },
    {
        id: 'luxury-cat-tree',
        name: '4-Tier Luxury Cat Tree',
        description: 'Solid wood construction with sisal scratching posts and a plush hammock.',
        image: 'https://images.unsplash.com/photo-1545249390-6bdfa286032f?auto=format&fit=crop&w=800&q=80',
        vendor: 'MeowDesign',
        price: 45000,
        category: 'toys',
        rating: 4.9,
    },
    {
        id: 'tropical-fish-tank',
        name: 'Starter Aquarium Kit (30L)',
        description: 'Everything you need to start your underwater world: filter, LED light, and gravel.',
        image: 'https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?auto=format&fit=crop&w=800&q=80',
        vendor: 'AquaLife',
        price: 85000,
        category: 'small-pets',
        rating: 4.6,
    }
];

async function main() {
    console.log(`Clearing old database and seeding PetHaven data...`);
    await prisma.product.deleteMany();
    for (const p of products) {
        await prisma.product.create({ data: p });
    }
    console.log(`Seeding finished.`);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());