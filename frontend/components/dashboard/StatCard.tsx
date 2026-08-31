import { Card } from '@/components/ui/card';

interface StatCardProps {
  title: string;
  value: string | number;
}

export default function StatCard({
  title,
  value,
}: StatCardProps) {
  return (
    <Card className="cti-stat-card" view="outlined">
      <div className="cti-stat-title">
        {title}
      </div>

      <div className="cti-stat-value">
        {value}
      </div>
    </Card>
  );
}
