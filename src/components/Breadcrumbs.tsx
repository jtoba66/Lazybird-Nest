import { CaretRight, House } from '@phosphor-icons/react';

interface BreadcrumbItem {
    id: number | null;
    name: string;
}

interface BreadcrumbsProps {
    path: BreadcrumbItem[];
    onNavigate: (id: number | null) => void;
}

export const Breadcrumbs = ({ path, onNavigate }: BreadcrumbsProps) => {
    return (
        <nav className="flex items-center text-sm font-medium text-text-muted overflow-x-auto whitespace-nowrap custom-scrollbar pb-1">
            <button
                onClick={() => onNavigate(null)}
                className={`flex items-center gap-1 transition-colors ${path.length === 0 ? 'text-text-main font-bold' : 'hover:text-primary'
                    }`}
            >
                <House size={18} weight={path.length === 0 ? "fill" : "bold"} />
                <span>Home</span>
            </button>

            {path.map((item, index) => {
                const isLast = index === path.length - 1;
                return (
                    <div key={item.id} className="flex items-center">
                        <CaretRight size={14} className="mx-2 text-text-muted/50" />
                        {isLast ? (
                            <span className="text-text-main font-bold truncate max-w-[200px]">
                                {item.name}
                            </span>
                        ) : (
                            <button
                                onClick={() => onNavigate(item.id)}
                                className="hover:text-primary transition-colors truncate max-w-[150px]"
                            >
                                {item.name}
                            </button>
                        )}
                    </div>
                );
            })}
        </nav>
    );
};
