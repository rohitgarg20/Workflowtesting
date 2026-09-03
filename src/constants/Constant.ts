import { colors } from "./Colors";
import { icons } from "./Icons";
import { strConstants } from "./Strings";

export enum TaskKeys {
    totalTask = 'totalTask',
    completedTask = 'completedTask'
}

interface TaskInfoItem {
    icon: string;
    displayLabel: string;
}

export enum TaskType {
    All = 'all',
    Active = "active",
    Done = 'done'
}

export interface ITaskType {
   id: TaskType,
   displayLabel: string,
   selected: boolean
}

export const TaskInfo: Record<TaskKeys, TaskInfoItem> = {
    [TaskKeys.totalTask]: {
        icon: icons.totalTask,
        displayLabel: strConstants.TOTAL_TASK
    },
    [TaskKeys.completedTask]: {
        icon: icons.completedTask,
        displayLabel: strConstants.COMPLETED_TASK
    }
}

export const TasksList: ITaskType[] = [
    {
        id: TaskType.All,
        displayLabel: 'All',
        selected: true
    },
    {
        id: TaskType.Active,
        displayLabel: 'Active',
        selected: false
    },
    {
        id: TaskType.Done,
        displayLabel: 'Done',
        selected: false
    }
]

export enum TaskPriority {
    Low = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    NONE = ''
}

export interface ITaskPriorityDetail {
    label: string,
    color: string
}

export const TaskPriorityMap: Map<TaskPriority,ITaskPriorityDetail> = new Map<TaskPriority,ITaskPriorityDetail>([
    [TaskPriority.Low, {
        label: 'Low',
        color: colors.lowPriority
    },
    ],
    [
        TaskPriority.MEDIUM, {
            label: 'Medium',
            color: colors.mediumPriority
        }
    ],
    [
        TaskPriority.HIGH, {
            label: 'High',
            color: colors.highPriority
        }
    ]
])

export interface ITaskDetailCard {
    description: string,
    priority: TaskPriority,
    timeStamp: Date,
    status: TaskType,
    title: string
}