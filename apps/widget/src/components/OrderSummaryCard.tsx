'use client';

import React from 'react';
import { Package, User, MapPin, Calendar, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import { OrderSummaryData } from '../types/chat';

export interface OrderSummaryCardProps {
  order: OrderSummaryData;
}

export const OrderSummaryCard: React.FC<OrderSummaryCardProps> = ({ order }) => {
  const getStatusBadge = (status: OrderSummaryData['status']) => {
    switch (status) {
      case 'accepted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Accepted
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800">
            <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            Rejected
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800">
            <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            Pending
          </span>
        );
      case 'processing':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800">
            <AlertCircle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            Processing
          </span>
        );
    }
  };

  return (
    <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm transition-all text-slate-800 dark:text-slate-100">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-brand dark:text-indigo-400 flex items-center justify-center">
            <Package className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">
              Order #{order.orderNumber}
            </h4>
            {order.orderDate && (
              <p className="text-[11px] text-slate-400 dark:text-slate-400 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {order.orderDate}
              </p>
            )}
          </div>
        </div>
        <div>{getStatusBadge(order.status)}</div>
      </div>

      {/* Customer & Shipping Details */}
      {(order.customerName || order.shippingAddress) && (
        <div className="px-3.5 py-2.5 bg-slate-50/30 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700/50 space-y-1.5 text-xs">
          {order.customerName && (
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium truncate">{order.customerName}</span>
            </div>
          )}
          {order.shippingAddress && (
            <div className="flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
              <span className="text-[11.5px] leading-tight line-clamp-2">{order.shippingAddress}</span>
            </div>
          )}
        </div>
      )}

      {/* Items List */}
      <div className="p-3.5 space-y-2">
        <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
          Items Ordered ({order.items?.length || 0})
        </p>
        <div className="space-y-1.5 divide-y divide-slate-100 dark:divide-slate-700/50">
          {order.items && order.items.length > 0 ? (
            order.items.map((item) => (
              <div key={item.id} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs">
                <div className="flex-1 min-w-0 pr-2">
                  <p className="font-medium text-slate-800 dark:text-slate-200 truncate">{item.name}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-400">Qty: {item.quantity}</p>
                </div>
                <div className="font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                  ${(item.price * item.quantity).toFixed(2)}
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-400">No items available</p>
          )}
        </div>
      </div>

      {/* Footer / Total */}
      <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Total Amount</span>
        <span className="text-sm font-bold text-brand dark:text-indigo-400">
          ${order.totalAmount.toFixed(2)}
        </span>
      </div>
    </div>
  );
};
