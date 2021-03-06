import { AuditService } from "src/audit/audit.service";
import { CreateAuditDto } from "src/audit/dto/audit.create-dto";
import {
  Connection,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from "typeorm";
import { UserEntity } from "./entity/user.entity";

@EventSubscriber()
export class UserSubscriber implements EntitySubscriberInterface<UserEntity> {
  constructor(connection: Connection, private readonly auditService: AuditService) {
    connection.subscribers.push(this);
  }

  listenTo() {
    return UserEntity;
  }

  beforeInsert(event: InsertEvent<UserEntity>) {
    console.log("BEFORE ENTITY INSERTED: ", event.entity);
    const dto: CreateAuditDto = {
      path: 'users',
      action: 'create',
      accountId: 0,
      pathId: null
    }
    this.auditService.createAudit(dto);
  }

  beforeUpdate(event: UpdateEvent<UserEntity>) {
    console.log("BEFORE ENTITY UPDATED: ", event.entity);
    const dto: CreateAuditDto = {
      path: 'users',
      action: 'update',
      accountId: 0,
      pathId: event.entity.id
    }
    this.auditService.createAudit(dto);
  }

  beforeRemove(event: RemoveEvent<UserEntity>) {
    console.log(
      `BEFORE ENTITY WITH ID ${event.entityId} REMOVED: `,
      event.entity
    );
    const dto: CreateAuditDto = {
      path: 'users',
      action: 'remove',
      accountId: 0,
      pathId: event.entity.id
    }
    this.auditService.createAudit(dto);
  }
}
