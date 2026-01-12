import xml.etree.ElementTree as ET
import json
import os

def convert_icd_xml_to_json(xml_path, json_output_path):
    print(f"Parsing XML file: {xml_path}")
    
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        
        icd_codes = {}
        
        # Recursive function to find all diag elements
        def process_element(element):
            # Check if this is a diag element
            if element.tag == 'diag':
                name_elem = element.find('name')
                desc_elem = element.find('desc')
                
                if name_elem is not None and desc_elem is not None:
                    code = name_elem.text.strip()
                    description = desc_elem.text.strip()
                    icd_codes[code] = description
            
            # Recurse into children
            for child in element:
                process_element(child)
                
        # Start processing from root
        process_element(root)
        
        print(f"Found {len(icd_codes)} ICD codes.")
        
        # Write to JSON
        with open(json_output_path, 'w', encoding='utf-8') as f:
            json.dump(icd_codes, f, indent=2)
            
        print(f"Successfully wrote JSON to: {json_output_path}")
        
    except Exception as e:
        print(f"Error converting XML to JSON: {e}")

if __name__ == "__main__":
    # Paths are relative to the project root
    xml_file = "icd10cm-table-index-April-2025/icd10cm-tabular-April-2025.xml"
    json_file = "public/icd10_codes.json"
    
    # Ensure public directory exists
    os.makedirs("public", exist_ok=True)
    
    convert_icd_xml_to_json(xml_file, json_file)

