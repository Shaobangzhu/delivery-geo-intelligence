import { pageNumbers, pageRange } from "./pageRange";
import "./pagination.css";

export function Pagination({ page, total, noun, label, disabled = false, onPageChange }: {
  page: number; total: number; noun: string; label: string; disabled?: boolean; onPageChange: (page: number) => void;
}) {
  const range = pageRange(page, total);
  return <div className="table-footer">
    <span>Showing {range.start}{total > 0 ? `–${range.end}` : ""} of {total} {noun}</span>
    <nav className="pagination" aria-label={label}>
      <button type="button" aria-label="Previous page" disabled={range.page <= 1 || disabled} onClick={() => onPageChange(range.page - 1)}>‹</button>
      {pageNumbers(range.page, range.totalPages).map((number) => <button key={number} type="button" aria-label={`Page ${number}`} aria-current={number === range.page ? "page" : undefined} disabled={disabled} onClick={() => onPageChange(number)}>{number}</button>)}
      <button type="button" aria-label="Next page" disabled={range.page >= range.totalPages || disabled} onClick={() => onPageChange(range.page + 1)}>›</button>
    </nav>
  </div>;
}
