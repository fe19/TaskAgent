/** An error whose `status` tells any UI how to report it (HTTP maps it 1:1). */
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new AppError(400, message);
export const notFound = (message) => new AppError(404, message);
export const conflict = (message) => new AppError(409, message);
