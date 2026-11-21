-- Apparel variants: available options on products, selected options on order lines.
ALTER TABLE "products" ADD COLUMN "colors" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "products" ADD COLUMN "sizes" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "order_items" ADD COLUMN "color" TEXT;
ALTER TABLE "order_items" ADD COLUMN "size" TEXT;
