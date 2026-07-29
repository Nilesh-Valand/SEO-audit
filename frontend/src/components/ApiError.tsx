import { Card, CardContent } from "@/components/ui/card";

export function ApiError({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-lg font-semibold text-gray-900">Something went wrong</p>
        <p className="mt-2 text-sm text-gray-500">{message}</p>
        <p className="mt-4 text-xs text-gray-400">
          Make sure the backend is running on port 8000 and migrations are up to date.
        </p>
      </CardContent>
    </Card>
  );
}
