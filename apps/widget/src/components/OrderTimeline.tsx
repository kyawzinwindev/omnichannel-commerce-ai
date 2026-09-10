'use client';

import React from 'react';
import { Check, Truck, Home, Package } from 'lucide-react';
import { OrderTimelineData, OrderTimelineStep } from '../types/chat';

export interface OrderTimelineProps {
  order: OrderTimelineData;
}

export const OrderTimeline: React.FC<OrderTimelineProps> = ({ order }) => {
  const getStepIcon = (step: OrderTimelineStep) => {
    switch (step.icon) {
      case 'check':
        return <Check className="w-3.5 h-3.5" />;
      case 'truck':
        return <Truck className="w-3.5 h-3.5" />;
      case 'home':
        return <Home className="w-3.5 h-3.5" />;
      case 'package':
      default:
        return step.status === 'completed' ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Package className="w-3.5 h-3.5" />
        );
    }
  };

  return (
    <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
      <div className="flex flex-col">
        {order.steps.map((step, index) => {
          const isLast = index === order.steps.length - 1;

          return (
            <div key={index} className="flex gap-3">
              <div className="flex flex-col items-center">
                {/* Completed Step */}
                {step.status === 'completed' && (
                  <div className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                    {getStepIcon(step)}
                  </div>
                )}

                {/* Current Active Step */}
                {step.status === 'current' && (
                  <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center shrink-0 ring-4 ring-indigo-100 dark:ring-indigo-950/60">
                    {getStepIcon(step)}
                  </div>
                )}

                {/* Pending Step */}
                {step.status === 'pending' && (
                  <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-400 flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-600">
                    {getStepIcon(step)}
                  </div>
                )}

                {/* Vertical Step Connector Line */}
                {!isLast && (
                  <div
                    className={`w-px flex-1 my-0.5 ${
                      step.status === 'completed'
                        ? 'bg-emerald-300 dark:bg-emerald-800'
                        : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                  />
                )}
              </div>

              <div className={!isLast ? 'pb-4' : ''}>
                <p
                  className={`text-[13px] ${
                    step.status === 'current'
                      ? 'font-semibold text-brand dark:text-indigo-400'
                      : step.status === 'completed'
                      ? 'font-medium text-slate-800 dark:text-slate-200'
                      : 'font-medium text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {step.title}
                </p>
                <p
                  className={`text-[11.5px] ${
                    step.status === 'current'
                      ? 'text-slate-500 dark:text-slate-400 font-medium'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {step.timestamp}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
