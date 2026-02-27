import { prisma } from '../lib/prisma';

export class TemplateRepository {
    async findAll() {
        return prisma.template.findMany({
            orderBy: { label: 'asc' }
        });
    }

    async create(data: { label: string; category: string; weight: number }) {
        return prisma.template.create({
            data
        });
    }

    async update(id: string, data: { label?: string; category?: string; weight?: number }) {
        return prisma.template.update({
            where: { id },
            data
        });
    }

    async delete(id: string) {
        return prisma.template.delete({
            where: { id }
        });
    }
}
