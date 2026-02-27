import { Request, Response } from 'express';
import { BaseController } from './BaseController';
import { TemplateService } from '../services/templateService';

export class TemplateController extends BaseController {
    constructor(private readonly templateService: TemplateService) {
        super();
    }

    async getAll(req: Request, res: Response) {
        try {
            const templates = await this.templateService.getAllTemplates();
            this.handleSuccess(res, templates);
        } catch (error) {
            this.handleError(error, res, 'TemplateController.getAll');
        }
    }

    async create(req: Request, res: Response) {
        try {
            const newTemplate = await this.templateService.createTemplate(req.body);
            this.handleSuccess(res, newTemplate, 201);
        } catch (error) {
            if (error instanceof Error && error.name === 'ZodError') {
                this.handleError(error, res, 'TemplateController.create', 400); // Bad Request for validation errors
            } else {
                this.handleError(error, res, 'TemplateController.create');
            }
        }
    }

    async update(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const updatedTemplate = await this.templateService.updateTemplate(id, req.body);
            this.handleSuccess(res, updatedTemplate);
        } catch (error) {
            this.handleError(error, res, 'TemplateController.update');
        }
    }

    async delete(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            await this.templateService.deleteTemplate(id);
            this.handleSuccess(res, { message: 'Template deleted successfully' });
        } catch (error) {
            this.handleError(error, res, 'TemplateController.delete');
        }
    }
}
