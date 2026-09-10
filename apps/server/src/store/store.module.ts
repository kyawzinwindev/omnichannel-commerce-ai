import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDbStoreProvider } from './providers/local-db-store.provider';
import { ExternalClientApiProvider } from './providers/external-client-api.provider';
import { STORE_PROVIDER } from './interfaces/store-provider.interface';
import { StoreController } from './store.controller';

@Global()
@Module({
  controllers: [StoreController],
  providers: [
    LocalDbStoreProvider,
    ExternalClientApiProvider,
    {
      provide: STORE_PROVIDER,
      useFactory: (
        config: ConfigService,
        localProvider: LocalDbStoreProvider,
        externalProvider: ExternalClientApiProvider,
      ) => {
        const type = config.get<string>('STORE_PROVIDER_TYPE', 'local_db');
        return type === 'external_api' ? externalProvider : localProvider;
      },
      inject: [ConfigService, LocalDbStoreProvider, ExternalClientApiProvider],
    },
  ],
  exports: [STORE_PROVIDER, LocalDbStoreProvider, ExternalClientApiProvider],
})
export class StoreModule { }
