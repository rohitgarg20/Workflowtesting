import { useEffect, useState } from "react"
import { storage } from "./mmkv/storage"
import { ITaskDetailCard } from "./constants/Constant"



export const useDebounce = ({ query }: { query: string }) => {
    const [filteredList, updateFilteredList] = useState<ITaskDetailCard[]>([])
    useEffect(() => {
        const timer = setTimeout(() => {
            const taskList = storage.getString('task_list')
            if (taskList && taskList.length > 0) {
                const parsedList = (JSON.parse(taskList) as ITaskDetailCard[]).filter((task) => {
                    return task.title.includes(query)
                })
                updateFilteredList(parsedList)
            }
        }, 300)
        return () => {
            clearTimeout(timer)
        }
    }, [query])
    return {
        filteredList
    }
}