import { TemplateRepository } from '../repositories/TemplateRepository';
import { createTemplateSchema, updateTemplateSchema, CreateTemplateInput, UpdateTemplateInput } from '../validators/template.schema';

export class TemplateService {
    constructor(private readonly templateRepository: TemplateRepository) { }

    async getAllTemplates() {
        return this.templateRepository.findAll();
    }

    async createTemplate(data: CreateTemplateInput) {
        const validatedData = createTemplateSchema.parse(data);
        return this.templateRepository.create(validatedData);
    }

    async updateTemplate(id: string, data: UpdateTemplateInput) {
        const validatedData = updateTemplateSchema.parse(data);
        return this.templateRepository.update(id, validatedData);
    }

    async deleteTemplate(id: string) {
        return this.templateRepository.delete(id);
    }
}
