import { OrderDetail } from "@/components/orders/OrdersPages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return <p className="p-6">Orden no válida.</p>;
  return <OrderDetail id={orderId} />;
}
