'use client';

import React, { useState } from 'react';
import { ShoppingBag, ShoppingCart, Check } from 'lucide-react';
import { ProductData } from '../types/chat';

export interface ProductCardProps {
  product: ProductData;
  onAddToCart?: (product: ProductData) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onAddToCart }) => {
  const [isAdded, setIsAdded] = useState(false);

  const handleAddToCart = () => {
    if (isAdded) return;
    setIsAdded(true);
    if (onAddToCart) {
      onAddToCart(product);
    }
    setTimeout(() => {
      setIsAdded(false);
    }, 1500);
  };

  return (
    <div className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex gap-3 p-3">
        <div className="shrink-0 w-20 h-20 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <ShoppingBag className="w-8 h-8 text-brand dark:text-indigo-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-snug truncate text-slate-800 dark:text-slate-100">
            {product.name}
          </p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
            {product.description || product.category || 'In stock'}
          </p>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[15px] font-semibold text-slate-900 dark:text-white">
              ${Number(product.price).toFixed(2)}
            </span>
            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800/40">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {product.inStock !== false ? 'In stock' : 'Low stock'}
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        data-add-to-cart
        onClick={handleAddToCart}
        disabled={isAdded}
        className={`add-to-cart-btn w-full flex items-center justify-center gap-1.5 text-[13px] font-medium transition py-2.5 border-t border-slate-200 dark:border-slate-700 focus:outline-none ${
          isAdded
            ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
            : 'text-brand dark:text-indigo-300 bg-brand-light dark:bg-slate-700/80 hover:bg-indigo-100 dark:hover:bg-slate-700 active:scale-[0.98]'
        }`}
      >
        {isAdded ? (
          <>
            <Check className="w-4 h-4" />
            <span>Added</span>
          </>
        ) : (
          <>
            <ShoppingCart className="w-4 h-4" />
            <span>Add to cart</span>
          </>
        )}
      </button>
    </div>
  );
};
