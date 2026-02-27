import { Response } from 'express';

export class BaseController {
  protected handleSuccess(res: Response, data: any, statusCode: number = 200) {
    return res.status(statusCode).json({
      success: true,
      data
    });
  }

  protected handleError(error: unknown, res: Response, context: string, statusCode: number = 500) {
    console.error(`Error in ${context}:`, error);
    // Ideally log to Sentry here as per guidelines

    return res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal Server Error'
    });
  }
}
