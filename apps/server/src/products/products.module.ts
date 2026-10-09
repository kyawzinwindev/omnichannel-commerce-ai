import { Global, Module } from '@nestjs/common';
import { LocalDbStoreProvider } from './providers/local-db-store.provider';
import { STORE_PROVIDER } from './interfaces/store-provider.interface';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Global()
@Module({
  controllers: [ProductsController],
  providers: [
    LocalDbStoreProvider,
    ProductsService,
    { provide: STORE_PROVIDER, useExisting: LocalDbStoreProvider },
  ],
  exports: [STORE_PROVIDER, LocalDbStoreProvider, ProductsService],
})
export class ProductsModule {}
