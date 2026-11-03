export const PAGE_SIZE = 10;

export function pageNumbers(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  return Array.from({ length: Math.min(totalPages, 5) }, (_, index) => start + index);
}

export function pageRange(page: number, total: number) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.max(1, Math.min(page, Math.max(1, totalPages)));
  const offset = (currentPage - 1) * PAGE_SIZE;
  return { page: currentPage, totalPages, offset, start: total ? offset + 1 : 0, end: Math.min(offset + PAGE_SIZE, total) };
}
