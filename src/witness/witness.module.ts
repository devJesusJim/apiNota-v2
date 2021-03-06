import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm/dist/typeorm.module";
import { StateEntity } from "src/state/entity/state.entity";
import { TimezoneEntity } from "src/timezone/entity/timezone.entity";
import { WitnessEntity } from "./entity/witness.entity";
import { WitnessController } from "./witness.controller";
import { WitnessService } from "./witness.service";
import { WitnessSubscriber } from "./witness.subscriber";

@Module({
  imports: [TypeOrmModule.forFeature([WitnessEntity, StateEntity, TimezoneEntity])],
  controllers: [WitnessController],
  providers: [WitnessService, WitnessSubscriber],
})
export class WitnessModule { }
