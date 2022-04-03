import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AccountEntity } from "src/account/entity/account.entity";
import { QBCallBackController } from "./callback.controller";
import { QBService } from "./quickbooks.service";

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AccountEntity]),
  ],
  providers: [QBService],
  controllers: [QBCallBackController],
  exports: [QBService],
})
export class QBModule { }