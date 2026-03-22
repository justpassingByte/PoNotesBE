
import { HandService } from './src/services/handService';
import { HandRepository } from './src/repositories/HandRepository';
import { UsageService } from './src/services/usageService';

// Mock objects for HandService dependency injection
const mockRepo = {} as any;
const mockUsage = {} as any;

const service = new HandService(mockRepo);

async function testDataExtraction() {
    console.log("--- Testing OCR Data Extraction Logic ---");

    // Case 1: OCR Output has { status: 'success', data: { board: [...] } }
    const res_wrapped = {
        status: 'success',
        result: {
            status: 'success',
            data: { board: ['As', 'Kd'], players: [] }
        }
    };

    console.log("Mock Response (Wrapped):", JSON.stringify(res_wrapped));
    
    // Simulate what's inside the poll loop
    const pollData = res_wrapped as any;
    const resultData = pollData.status === 'success' ? (pollData.result.data || pollData.result) : null;
    console.log("Extracted Data (Case 1):", JSON.stringify(resultData));

    // Case 2: OCR Output has JUST the dict { board: [...] } inside result
    const res_flat = {
        status: 'success',
        result: { board: ['Qh', 'Jc'], players: [] }
    } as any;
    
    console.log("\nMock Response (Flat):", JSON.stringify(res_flat));
    const resultData2 = res_flat.status === 'success' ? (res_flat.result.data || res_flat.result) : null;
    console.log("Extracted Data (Case 2):", JSON.stringify(resultData2));
}

testDataExtraction();
